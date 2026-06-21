/**
 * Data Stash HTTP helpers — Server Only
 *
 * Shared auth + response helpers for the Data Stash upload routes
 * (`/api/stash/upload`, `/api/stash/document/:id`). Mirrors the auth posture
 * of the existing `routes/api/stash.ts` (dev-bypass aware) so the upload path
 * and the hide/archive path gate access the same way.
 */

import { assertServerOnImport } from '../harness-patterns/assert.server'
import { getAuthenticatedUser } from '../auth/server'
import { BYPASS_USER, isBypassEnabled } from '../auth/dev-bypass'

assertServerOnImport()

/** Resolve the current user id, honouring the dev-bypass switch. */
export async function requireUserId(): Promise<string> {
  if (isBypassEnabled()) return BYPASS_USER.id
  return (await getAuthenticatedUser()).id
}

/** JSON response with the right content-type. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Run a handler with an authenticated user id, returning a 401 JSON response
 * if authentication fails. Keeps each route handler free of the try/catch
 * auth boilerplate.
 *
 * Note: documents are keyed by `sessionId` (an unguessable UUID) and access is
 * gated on authentication. Per-session ownership verification (as `stash.ts`
 * does via `loadSession`) is intentionally not enforced here because uploads
 * can precede the session's first persisted turn; layer it on if uploads are
 * ever guaranteed post-session-creation.
 */
export async function withUser(
  fn: (userId: string) => Promise<Response>,
): Promise<Response> {
  let userId: string
  try {
    userId = await requireUserId()
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : 'Unauthorized' },
      401,
    )
  }
  return fn(userId)
}
