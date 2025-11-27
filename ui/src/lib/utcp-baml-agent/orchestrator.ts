/**
 * Agent Orchestrator (Client-Side)
 *
 * Coordinates the knowledge graph agent's operations via server functions:
 * - Processes user messages with BAML functions (server-side)
 * - Executes graph queries via UTCP (server-side)
 * - Manages conversation state (client-side via thread events)
 * - Handles user-confirmed writes (via server functions)
 *
 * Architecture:
 * - Uses lib/neo4j for non-agentic operations (schema, manual Cypher)
 * - Uses lib/utcp-baml-agent for agentic operations (BAML + UTCP)
 */

import type { ElementDefinition } from 'cytoscape';
import { getSchema } from '../neo4j/queries';
import {
  processAgentMessage,
  executeApprovedWrite,
  rejectWrite,
  initializeAgent,
  type SerializedThread
} from './index';
import type { GraphQuery } from '../../../baml_client';

// ============================================================================
// Types
// ============================================================================

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
  graphData?: ElementDefinition[];
}

export interface ToolCall {
  tool: string;
  parameters: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'executed';
  result?: unknown;
  explanation?: string;
}

export interface ProcessMessageResult {
  response: AgentMessage;
  graphUpdate?: ElementDefinition[];
  needsApproval?: boolean;
  pendingQuery?: GraphQuery;
}

// ============================================================================
// Agent Orchestrator Class
// ============================================================================

export class AgentOrchestrator {
  private threadEvents: SerializedThread = [];
  private graphSchema: string | null = null;
  private isInitialized = false;
  private pendingWrite: GraphQuery | null = null;

  /**
   * Initialize the agent
   * Fetches the Neo4j schema on startup via server function
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      console.log('🤖 Initializing Agent Orchestrator...');

      // Use non-agentic layer for schema (direct neo4j-driver)
      const result = await initializeAgent();

      if (!result.success) {
        throw new Error(result.error || 'Failed to initialize');
      }

      this.graphSchema = result.graphSchema || null;

      console.log('✅ Agent initialized successfully');
      console.log('   - Schema loaded:', !!this.graphSchema);

      this.isInitialized = true;
    } catch (error) {
      console.error('❌ Agent initialization failed:', error);
      throw new Error(`Failed to initialize agent: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Process a user message
   * Uses agentic layer (BAML + UTCP) via server function
   */
  async processMessage(userMessage: string): Promise<ProcessMessageResult> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      // Call server function to process message with BAML
      const result = await processAgentMessage(
        userMessage,
        this.threadEvents,
        this.graphSchema || undefined
      );

      // Update thread state
      this.threadEvents = result.threadEvents;

      // Store pending write if needs approval
      if (result.needsApproval && result.pendingQuery) {
        this.pendingWrite = result.pendingQuery;
      }

      // Convert timestamp string back to Date
      const agentMessage: AgentMessage = {
        id: result.response.id,
        role: result.response.role,
        content: result.response.content,
        timestamp: new Date(result.response.timestamp),
        toolCalls: result.response.toolCalls
      };

      return {
        response: agentMessage,
        graphUpdate: result.graphUpdate,
        needsApproval: result.needsApproval,
        pendingQuery: result.pendingQuery
      };
    } catch (error) {
      console.error('Error processing message:', error);

      // Return error response
      return {
        response: {
          id: Date.now().toString(),
          role: 'assistant',
          content: `I encountered an error while processing your request:\n\n\`\`\`\n${error instanceof Error ? error.message : String(error)}\n\`\`\`\n\nPlease try rephrasing your question.`,
          timestamp: new Date()
        }
      };
    }
  }

  /**
   * Execute a write query (after user approval)
   * Uses agentic layer via server function
   * @param query - Optional query override (uses pending query if not provided)
   * @returns Updated graph elements
   */
  async executeWriteQuery(query?: string): Promise<ElementDefinition[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const queryToExecute = query || this.pendingWrite?.cypher;
    const explanation = this.pendingWrite?.explanation || 'User-approved write operation';

    if (!queryToExecute) {
      throw new Error('No query to execute');
    }

    try {
      console.log('✏️ Executing write query:', queryToExecute);

      // Execute write query via server function
      const result = await executeApprovedWrite(
        queryToExecute,
        explanation,
        this.threadEvents
      );

      if (!result.success) {
        throw new Error(result.error || 'Failed to execute write query');
      }

      // Update thread state
      this.threadEvents = result.threadEvents;

      // Clear pending write
      this.pendingWrite = null;

      console.log('✅ Write query executed successfully');

      return result.graphUpdate || [];
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
    this.pendingWrite = null;

    return result.message;
  }

  /**
   * Check if there's a pending write awaiting approval
   */
  hasPendingWrite(): boolean {
    return this.pendingWrite !== null;
  }

  /**
   * Get the pending write query
   */
  getPendingWrite(): GraphQuery | null {
    return this.pendingWrite;
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
  clearConversationHistory(): void {
    this.threadEvents = [];
    this.pendingWrite = null;
    console.log('🧹 Conversation history cleared');
  }

  /**
   * Get graph schema
   */
  getGraphSchema(): string | null {
    return this.graphSchema;
  }

  /**
   * Refresh graph schema
   * Uses non-agentic layer (direct neo4j-driver)
   */
  async refreshSchema(): Promise<void> {
    try {
      const result = await getSchema();

      if (!result.success) {
        throw new Error(result.error || 'Failed to refresh schema');
      }

      this.graphSchema = result.schema || null;
      console.log('✅ Schema refreshed');
    } catch (error) {
      console.error('❌ Failed to refresh schema:', error);
      throw error;
    }
  }
}
