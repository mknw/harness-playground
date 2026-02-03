/**
 * Harness Client - Public API
 *
 * Server actions for frontend integration.
 * Session management is internal (not exported to client).
 */

// Server Actions (safe to import in components)
export {
  processMessage,
  processMessageWithAgent,
  approveAction,
  rejectAction,
  clearSession
} from './actions.server'

// Agent Registry
export {
  getAgentMetadata,
  type AgentConfig
} from './registry.server'

// Graph Extraction (client-safe)
export {
  extractGraphElements,
  extractGraphFromResult
} from './graph-extractor'

// Types
export type { GraphElement } from './types'
