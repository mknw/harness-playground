/**
 * Agent Types
 *
 * This file previously contained the agent loop logic.
 * The logic has been moved to server.ts for the simplified two-step flow.
 *
 * This file is kept for type exports only.
 */

import type { GraphQuery } from '../../../baml_client'
import type { ElementDefinition } from 'cytoscape'
import type { Thread } from './state'

// ============================================================================
// Legacy Types (kept for backwards compatibility)
// ============================================================================

export interface AgentLoopResult {
  thread: Thread
  message: string
  graphData?: ElementDefinition[]
  needsApproval: boolean
  pendingQuery?: GraphQuery
}
