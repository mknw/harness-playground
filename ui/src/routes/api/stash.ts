/**
 * Data Stash API — Hide / Unhide / Archive / Unarchive tool results
 *
 * Mutates the in-memory session context and re-serializes.
 * Hidden/archived tool results are excluded from serializeCompact()
 * so loop patterns no longer see them.
 */
import type { APIEvent } from "@solidjs/start/server";
import { getSession, updateSession } from "../../lib/harness-client/session.server";
import { enrichToolResult, serializeContext } from "../../lib/harness-patterns";

type StashAction = "hide" | "unhide" | "archive" | "unarchive";

export async function POST(event: APIEvent) {
  const body = await event.request.json();
  const { sessionId, eventId, action } = body as {
    sessionId: string;
    eventId: string;
    action: StashAction;
  };

  if (!sessionId || !eventId || !action) {
    return new Response(
      JSON.stringify({ error: "sessionId, eventId, and action are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const session = getSession(sessionId);
  if (!session?.lastResult?.context) {
    return new Response(
      JSON.stringify({ error: "Session not found or no context available" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  const ctx = session.lastResult.context;
  const patch: { hidden?: boolean; archived?: boolean } = {};

  switch (action) {
    case "hide":
      patch.hidden = true;
      break;
    case "unhide":
      patch.hidden = false;
      break;
    case "archive":
      patch.archived = true;
      patch.hidden = false;
      break;
    case "unarchive":
      patch.archived = false;
      break;
    default:
      return new Response(
        JSON.stringify({ error: `Invalid action: ${action}` }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
  }

  const found = enrichToolResult(ctx, eventId, patch);
  if (!found) {
    return new Response(
      JSON.stringify({ error: "Tool result event not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  updateSession(sessionId, {
    serializedContext: serializeContext(ctx),
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
