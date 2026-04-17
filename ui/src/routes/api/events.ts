/**
 * SSE Endpoint for Streaming Agent Events
 *
 * Streams ContextEvents in real-time as they are committed during harness execution.
 * Enables reactive UI updates (e.g., graph visualization) without waiting for full completion.
 */
import type { APIEvent } from "@solidjs/start/server";
import { processMessageStreaming } from "../../lib/harness-client/actions.server";

export async function POST(event: APIEvent) {
  const body = await event.request.json();
  const { sessionId, message, agentId } = body as {
    sessionId: string;
    message: string;
    agentId?: string;
  };

  if (!sessionId || !message) {
    return new Response(JSON.stringify({ error: "sessionId and message are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const result = await processMessageStreaming(
          sessionId,
          message,
          agentId ?? "default",
          (evt) => {
            const data = JSON.stringify(evt);
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          },
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
