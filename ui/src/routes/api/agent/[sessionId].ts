/**
 * Agent Session API Route
 *
 * SolidStart API route for managing agent sessions.
 * Each session has its own orchestrator instance.
 *
 * POST /api/agent/:sessionId - Process a message
 * DELETE /api/agent/:sessionId - Clear session
 */

import type { APIEvent } from '@solidjs/start/server';
import { AgentOrchestrator } from '~/lib/harness-patterns';
import type { OrchestratorResult } from '~/lib/harness-patterns';

// Session storage - in production, use Redis or similar
const sessions = new Map<string, AgentOrchestrator>();

/**
 * Get or create orchestrator for session
 */
function getOrchestrator(sessionId: string): AgentOrchestrator {
  let orchestrator = sessions.get(sessionId);
  if (!orchestrator) {
    orchestrator = new AgentOrchestrator();
    sessions.set(sessionId, orchestrator);
  }
  return orchestrator;
}

/**
 * POST - Process a message in the session
 */
export async function POST(event: APIEvent): Promise<Response> {
  "use server";

  const sessionId = event.params.sessionId;
  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'Session ID required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await event.request.json();
    const { message, action } = body as { message?: string; action?: 'approve' | 'reject'; reason?: string };

    const orchestrator = getOrchestrator(sessionId);
    let result: OrchestratorResult;

    if (action === 'approve') {
      result = await orchestrator.approveOperation();
    } else if (action === 'reject') {
      result = await orchestrator.rejectOperation(body.reason);
    } else if (message) {
      result = await orchestrator.processMessage(message);
    } else {
      return new Response(JSON.stringify({ error: 'Message or action required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * DELETE - Clear session
 */
export async function DELETE(event: APIEvent): Promise<Response> {
  "use server";

  const sessionId = event.params.sessionId;
  if (!sessionId) {
    return new Response(null, { status: 400 });
  }

  const orchestrator = sessions.get(sessionId);
  if (orchestrator) {
    orchestrator.clearConversation();
    sessions.delete(sessionId);
  }

  return new Response(null, { status: 204 });
}

/**
 * GET - Check session status
 */
export async function GET(event: APIEvent): Promise<Response> {
  "use server";

  const sessionId = event.params.sessionId;
  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'Session ID required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const orchestrator = sessions.get(sessionId);
  const status = {
    exists: !!orchestrator,
    hasPendingApproval: orchestrator?.hasPendingApproval() ?? false
  };

  return new Response(JSON.stringify(status), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
