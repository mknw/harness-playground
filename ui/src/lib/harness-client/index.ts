/**
 * Harness Client - Public API
 *
 * Server actions for frontend integration.
 * Session management is internal (not exported to client).
 */

// Server Actions (safe to import in components)
export {
  processMessage,
  approveAction,
  rejectAction,
  clearSession
} from './actions.server'
