/**
 * SSE Endpoint for Streaming Agent Events
 *
 * Streams ContextEvents in real-time as they are committed during harness execution.
 * Enables reactive UI updates (e.g., graph visualization) without waiting for full completion.
 */
import type { APIEvent } from "@solidjs/start/server";
import { processMessageStreaming } from "../../lib/harness-client/actions.server";
import { saveSession } from "../../lib/harness-client/session.server";
import { scheduleSummarization, serializeContext } from "../../lib/harness-patterns";
import { getAuthenticatedUser } from "../../lib/auth/server";
import type { HarnessSettings } from "../../lib/settings";

async function requireUserId(): Promise<string> {
  if (import.meta.env.VITE_DEV_BYPASS_AUTH === "true") return "dev-bypass-user";
  return (await getAuthenticatedUser()).id;
}

export async function POST(event: APIEvent) {
  const body = await event.request.json();
  const { sessionId, message, agentId, settings } = body as {
    sessionId: string;
    message: string;
    agentId?: string;
    settings?: HarnessSettings;
  };

  if (!sessionId || !message) {
    return new Response(JSON.stringify({ error: "sessionId and message are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Auth here so we have a userId for the post-response background save —
  // the wrapped server action below also authenticates (defense in depth).
  let userId: string;
  try {
    userId = await requireUserId();
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }
  const resolvedAgentId = agentId ?? "default";

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const result = await processMessageStreaming(
          sessionId,
          message,
          resolvedAgentId,
          (evt) => {
            const data = JSON.stringify(evt);
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          },
          settings,
        );

        // Send final result as a named event
        const doneData = JSON.stringify({
          response: result.response,
          data: result.data,
          status: result.status,
          duration_ms: result.duration_ms,
          context: result.context,
          serialized: result.serialized,
        });
        controller.enqueue(encoder.encode(`event: done\ndata: ${doneData}\n\n`));
        controller.close();

        // Fire-and-forget: summarize this turn's tool results in the background.
        // Runs after the SSE stream is closed — user already has the response.
        // Summaries are stored on tool_result events and persisted to session,
        // so they appear as compact pointers on subsequent turns.
        scheduleSummarization(result.context, async () => {
          await saveSession(
            sessionId,
            userId,
            resolvedAgentId,
            serializeContext(result.context),
          );
        }).catch((err) =>
          console.error("[summarize] background summarization failed:", err),
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`),
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
