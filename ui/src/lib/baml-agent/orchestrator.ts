/**
 * Agent Orchestrator (Client-Side)
 *
 * Simplified orchestrator that:
 * - Does NOT pre-fetch schema (lazy loading in server)
 * - Delegates all logic to server functions
 * - Manages thread state locally
 * - Tracks pending writes for approval flow
 *
 * Architecture:
 * - Server handles: BAML reasoning, schema fetching, query execution
 * - Client handles: UI state, thread events, approval coordination
 */

import type { ElementDefinition } from 'cytoscape';
import {
  processAgentMessageStreaming,
  executeApprovedWrite,
  rejectWrite,
  type SerializedThread,
  type ToolCallInfo,
  type ToolExecutionPlan,
  type StreamEvent
} from './server';

// ============================================================================
// Types
// ============================================================================

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  toolCall?: ToolCallInfo;  // Single tool call (not array)
  graphData?: ElementDefinition[];
}

export interface ProcessMessageOutput {
  response: AgentMessage;
  events: StreamEvent[];
  graphUpdate?: ElementDefinition[];
  needsApproval?: boolean;
  pendingPlan?: ToolExecutionPlan;
}

// ============================================================================
// Agent Orchestrator Class
// ============================================================================

export class AgentOrchestrator {
  private threadEvents: SerializedThread = [];
  private pendingPlan: ToolExecutionPlan | null = null;

  // NO initialize() method - schema is fetched lazily when needed

  /**
   * Process a user message
   * Server handles: intent detection → optional schema fetch → query execution
   * Returns streaming events for real-time UI updates
   */
  async processMessage(userMessage: string): Promise<ProcessMessageOutput> {
    try {
      // Call server function (multi-turn tool loop happens server-side)
      const result = await processAgentMessageStreaming(userMessage, this.threadEvents);

      // Update thread state
      this.threadEvents = result.threadEvents;

      // Store pending plan if needs approval
      if (result.needsApproval && result.pendingPlan) {
        this.pendingPlan = result.pendingPlan;
      }

      // Extract response from events
      const completeEvent = result.events.find(e => e.type === 'complete');
      const errorEvent = result.events.find(e => e.type === 'error');

      const content = errorEvent
        ? `Error: ${errorEvent.data}`
        : completeEvent
          ? String(completeEvent.data)
          : result.needsApproval && result.pendingPlan
            ? `This operation requires your approval:\n\n**Query:**\n\`\`\`cypher\n${this.getPendingQuery()}\n\`\`\`\n\n**Explanation:** ${result.pendingPlan.reasoning}`
            : 'Processing...';

      // Build toolCall for pending approval so UI can render Approve/Reject buttons
      let toolCall: ToolCallInfo | undefined;
      if (result.needsApproval && result.pendingPlan) {
        toolCall = {
          type: 'neo4j',  // Write operations are always neo4j
          status: 'pending',
          tool: result.pendingPlan.toolName,
          cypher: this.getPendingQuery() || undefined,
          explanation: result.pendingPlan.reasoning,
          isReadOnly: false
        };
      }

      const agentMessage: AgentMessage = {
        id: Date.now().toString(),
        role: 'assistant',
        content,
        timestamp: new Date(),
        toolCall,
        graphData: result.graphUpdate
      };

      return {
        response: agentMessage,
        events: result.events,
        graphUpdate: result.graphUpdate,
        needsApproval: result.needsApproval,
        pendingPlan: result.pendingPlan
      };
    } catch (error) {
      console.error('Error processing message:', error);

      return {
        response: {
          id: Date.now().toString(),
          role: 'assistant',
          content: `Error: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: new Date()
        },
        events: []
      };
    }
  }

  /**
   * Execute a write query after user approval
   * @returns Object containing graph update and updated tool call info
   */
  async executeWriteQuery(): Promise<{
    graphUpdate: ElementDefinition[];
    toolCall?: ToolCallInfo;
  }> {
    if (!this.pendingPlan) {
      throw new Error('No pending write plan');
    }

    try {
      console.log('✏️ Executing approved write:', this.pendingPlan.description);

      const result = await executeApprovedWrite(
        this.pendingPlan,
        this.threadEvents
      );

      if (!result.success) {
        throw new Error(result.error || 'Write query failed');
      }

      // Update thread state
      this.threadEvents = result.threadEvents;

      // Clear pending plan
      this.pendingPlan = null;

      console.log('✅ Write query executed');

      return {
        graphUpdate: result.graphUpdate || [],
        toolCall: result.toolCall
      };
    } catch (error) {
      console.error('Error executing write query:', error);
      throw error;
    }
  }

  /**
   * Reject a pending write operation
   * @param reason - Optional reason for rejection
   */
  async rejectPendingWrite(reason?: string): Promise<string> {
    const result = await rejectWrite(reason, this.threadEvents);

    // Update thread state
    this.threadEvents = result.threadEvents;

    // Clear pending plan
    this.pendingPlan = null;

    return result.message;
  }

  /**
   * Check if there's a pending write awaiting approval
   */
  hasPendingWrite(): boolean {
    return this.pendingPlan !== null;
  }

  /**
   * Get the pending write cypher query (extracted from plan)
   */
  getPendingQuery(): string | null {
    if (!this.pendingPlan) return null;
    try {
      const payload = JSON.parse(this.pendingPlan.payload);
      return payload.query || this.pendingPlan.payload;
    } catch {
      return this.pendingPlan.payload;
    }
  }

  /**
   * Get the pending write reasoning/explanation
   */
  getPendingExplanation(): string | null {
    return this.pendingPlan?.reasoning || null;
  }

  /**
   * Get the pending plan (for advanced usage)
   */
  getPendingPlan(): ToolExecutionPlan | null {
    return this.pendingPlan;
  }

  /**
   * Get thread events (for debugging/persistence)
   */
  getThreadEvents(): SerializedThread {
    return [...this.threadEvents];
  }

  /**
   * Clear conversation history
   */
  clearConversation(): void {
    this.threadEvents = [];
    this.pendingPlan = null;
    console.log('🧹 Conversation cleared');
  }
}

// Re-export types
export type { ToolCallInfo, SerializedThread };
