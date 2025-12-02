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
  processAgentMessage,
  executeApprovedWrite,
  rejectWrite,
  type SerializedThread,
  type ToolCallInfo
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

export interface ProcessMessageResult {
  response: AgentMessage;
  graphUpdate?: ElementDefinition[];
  needsApproval?: boolean;
  pendingCypher?: string;
  pendingExplanation?: string;
}

// ============================================================================
// Agent Orchestrator Class
// ============================================================================

export class AgentOrchestrator {
  private threadEvents: SerializedThread = [];
  private pendingCypher: string | null = null;
  private pendingExplanation: string | null = null;

  // NO initialize() method - schema is fetched lazily when needed

  /**
   * Process a user message
   * Server handles: intent detection → optional schema fetch → query execution
   */
  async processMessage(userMessage: string): Promise<ProcessMessageResult> {
    try {
      // Call server function (two-step flow happens server-side)
      const result = await processAgentMessage(userMessage, this.threadEvents);

      // Update thread state
      this.threadEvents = result.threadEvents;

      // Store pending write info if needs approval
      if (result.needsApproval && result.pendingCypher) {
        this.pendingCypher = result.pendingCypher;
        this.pendingExplanation = result.pendingExplanation || null;
      }

      // Convert timestamp string back to Date
      const agentMessage: AgentMessage = {
        id: result.response.id,
        role: result.response.role,
        content: result.response.content,
        timestamp: new Date(result.response.timestamp),
        toolCall: result.toolCall,
        graphData: result.graphUpdate
      };

      return {
        response: agentMessage,
        graphUpdate: result.graphUpdate,
        needsApproval: result.needsApproval,
        pendingCypher: result.pendingCypher,
        pendingExplanation: result.pendingExplanation
      };
    } catch (error) {
      console.error('Error processing message:', error);

      return {
        response: {
          id: Date.now().toString(),
          role: 'assistant',
          content: `Error: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: new Date()
        }
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
    if (!this.pendingCypher) {
      throw new Error('No pending write query');
    }

    try {
      console.log('✏️ Executing write query:', this.pendingCypher);

      const result = await executeApprovedWrite(
        this.pendingCypher,
        this.pendingExplanation || 'User-approved write',
        this.threadEvents
      );

      if (!result.success) {
        throw new Error(result.error || 'Write query failed');
      }

      // Update thread state
      this.threadEvents = result.threadEvents;

      // Clear pending write
      this.pendingCypher = null;
      this.pendingExplanation = null;

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

    // Clear pending write
    this.pendingCypher = null;
    this.pendingExplanation = null;

    return result.message;
  }

  /**
   * Check if there's a pending write awaiting approval
   */
  hasPendingWrite(): boolean {
    return this.pendingCypher !== null;
  }

  /**
   * Get the pending write cypher query
   */
  getPendingCypher(): string | null {
    return this.pendingCypher;
  }

  /**
   * Get the pending write explanation
   */
  getPendingExplanation(): string | null {
    return this.pendingExplanation;
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
    this.pendingCypher = null;
    this.pendingExplanation = null;
    console.log('🧹 Conversation cleared');
  }
}

// Re-export types
export type { ToolCallInfo, SerializedThread };
