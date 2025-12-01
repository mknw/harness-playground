/**
 * Thread State Management (12-Factor-Agents Pattern)
 *
 * Event-based thread state for agent conversation history.
 * Following the 12-factor-agents pattern for:
 * - Immutable event streams
 * - XML-like serialization for LLM context
 * - Clean separation of concerns
 *
 * Reference: /Users/mknw/Code/12-factor-agents/packages/create-12-factor-agent/template
 */

// ============================================================================
// Constants
// ============================================================================

/** Maximum number of turns per tool execution loop */
export const MAX_TOOL_TURNS = 5;

/** Token limit before pruning older ToolEvents */
export const MAX_THREAD_TOKENS = 8000;

// ============================================================================
// Tool Types
// ============================================================================

/** Tool execution modes (in order of preference) */
export type ToolMode = 'mcp' | 'code_mode' | null;

/** Available tool namespaces */
export type ToolNamespace = 'neo4j' | 'web_search' | 'code_mode';

/** Approval levels for destructive operations */
export type ApprovalLevel = 'one_time' | 'thread' | 'tool_based';

/** State tracking approvals granted during session */
export interface ApprovalState {
  threadApproved: boolean;
  toolApprovals: Set<string>;  // tool names with thread-level approval
}

// ============================================================================
// Streaming Event Types
// ============================================================================

/** Step 1 output: Routing decision from first BAML function */
export interface RoutingInterfaceEvent {
  intent: string;
  tool_call_needed: boolean;
  tool_mode: ToolMode;
  tool_name: ToolNamespace | null;
  response_text: string;
}

/** Step 6 output: Tool execution plan from namespace-specific BAML function */
export interface ToolExecutionPlan {
  reasoning: string;
  toolName: string;
  payload: string;  // JSON string for tool arguments
  description: string;  // User-facing status message
  end_tool: boolean;  // true if all info retrieved OR max turns reached
}

/** Step 8 output: Result from tool execution */
export interface ToolEvent {
  status_code: 200 | 400 | 404 | 500;
  status_description: string;
  operation: string;  // the query/command executed
  data: unknown;
  n_turn: number;  // Current turn number (1-indexed)
  stats?: {
    nodeCount?: number;
    relationshipCount?: number;
    duration_ms?: number;
    token_count?: number;  // Estimated tokens in data
  };
}

/** Streaming event types for real-time UI updates */
export type StreamEventType = 'routing' | 'planning' | 'executing' | 'processing' | 'complete' | 'error';

/** Wrapper for streaming events */
export interface StreamEvent {
  type: StreamEventType;
  data: RoutingInterfaceEvent | ToolExecutionPlan | ToolEvent | string;
  timestamp: string;
}

// ============================================================================
// Thread Event Types
// ============================================================================

/**
 * Event types for the agent conversation thread
 */
export type ThreadEventType =
  | 'user_message'
  | 'tool_call'
  | 'tool_response'
  | 'assistant_message'
  | 'approval_request'
  | 'approval_response'
  | 'system_message'
  | 'error';

/**
 * A single event in the conversation thread
 */
export interface ThreadEvent {
  type: ThreadEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

/**
 * Serialized thread for transport between client and server
 */
export type SerializedThread = ThreadEvent[];

// ============================================================================
// Thread Class
// ============================================================================

/**
 * Thread class for managing agent conversation state
 *
 * Key features:
 * - Immutable event stream
 * - XML-like serialization for LLM context
 * - Easy serialization/deserialization for client-server transport
 */
export class Thread {
  events: ThreadEvent[] = [];

  /**
   * Create a new thread, optionally restoring from serialized events
   */
  constructor(initialEvents: ThreadEvent[] = []) {
    this.events = initialEvents;
  }

  /**
   * Add an event to the thread
   */
  addEvent(event: Omit<ThreadEvent, 'timestamp'>): void {
    this.events.push({
      ...event,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Add a user message event
   */
  addUserMessage(content: string): void {
    this.addEvent({
      type: 'user_message',
      data: { content }
    });
  }

  /**
   * Add an assistant message event
   */
  addAssistantMessage(content: string): void {
    this.addEvent({
      type: 'assistant_message',
      data: { content }
    });
  }

  /**
   * Add a tool call event
   */
  addToolCall(tool: string, parameters: Record<string, unknown>, intent?: string): void {
    this.addEvent({
      type: 'tool_call',
      data: { tool, parameters, intent }
    });
  }

  /**
   * Add a tool response event
   */
  addToolResponse(tool: string, result: unknown, metadata?: Record<string, unknown>): void {
    this.addEvent({
      type: 'tool_response',
      data: { tool, result, ...metadata }
    });
  }

  /**
   * Add an approval request event (for write operations)
   */
  addApprovalRequest(query: string, explanation: string): void {
    this.addEvent({
      type: 'approval_request',
      data: { query, explanation }
    });
  }

  /**
   * Add an approval response event
   */
  addApprovalResponse(approved: boolean, reason?: string): void {
    this.addEvent({
      type: 'approval_response',
      data: { approved, reason }
    });
  }

  /**
   * Add a system message event
   */
  addSystemMessage(content: string): void {
    this.addEvent({
      type: 'system_message',
      data: { content }
    });
  }

  /**
   * Add an error event
   */
  addError(error: string, context?: Record<string, unknown>): void {
    this.addEvent({
      type: 'error',
      data: { error, ...context }
    });
  }

  /**
   * Get the last event of a specific type
   */
  getLastEvent(type?: ThreadEventType): ThreadEvent | undefined {
    if (type) {
      return [...this.events].reverse().find(e => e.type === type);
    }
    return this.events[this.events.length - 1];
  }

  /**
   * Get the last user message content
   */
  getLastUserMessage(): string | undefined {
    const event = this.getLastEvent('user_message');
    return event?.data.content as string | undefined;
  }

  /**
   * Check if there's a pending approval request
   */
  hasPendingApproval(): boolean {
    const lastApprovalRequest = this.getLastEvent('approval_request');
    if (!lastApprovalRequest) return false;

    const lastApprovalResponse = this.getLastEvent('approval_response');
    if (!lastApprovalResponse) return true;

    // Check if request came after the last response
    return new Date(lastApprovalRequest.timestamp) > new Date(lastApprovalResponse.timestamp);
  }

  /**
   * Serialize thread for LLM context (XML-like format)
   * Following 12-factor-agents pattern
   */
  serializeForLLM(): string {
    return this.events
      .map(event => {
        const dataLines = Object.entries(event.data)
          .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
          .join('\n');

        return `<${event.type}>
${dataLines}
</${event.type}>`;
      })
      .join('\n\n');
  }

  /**
   * Get recent history as a simple string array
   * Useful for compact context
   */
  getRecentHistory(maxItems: number = 10): string[] {
    return this.events
      .slice(-maxItems)
      .filter(e => e.type === 'user_message' || e.type === 'assistant_message')
      .map(e => {
        const role = e.type === 'user_message' ? 'User' : 'Assistant';
        return `${role}: ${e.data.content}`;
      });
  }

  /**
   * Serialize for transport between client and server
   */
  toJSON(): SerializedThread {
    return this.events;
  }

  /**
   * Create thread from serialized events
   */
  static fromJSON(events: SerializedThread): Thread {
    return new Thread(events);
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Estimate token count from text (rough: 4 chars ≈ 1 token)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Create initial approval state
 */
export function createApprovalState(): ApprovalState {
  return {
    threadApproved: false,
    toolApprovals: new Set()
  };
}

/**
 * Check if a tool operation requires approval based on current state
 */
export function requiresApproval(
  plan: ToolExecutionPlan,
  approvalState: ApprovalState
): boolean {
  // Write operations need approval
  const isWriteOperation = plan.toolName.includes('write');

  if (!isWriteOperation) {
    return false;
  }

  // Check if already approved for this session
  if (approvalState.threadApproved) {
    return false;
  }

  // Check if this specific tool is approved
  if (approvalState.toolApprovals.has(plan.toolName)) {
    return false;
  }

  return true;
}

/**
 * Prepare previous ToolEvents for context, pruning if token limit exceeded
 */
export function prepareResultsForContext(toolEvents: ToolEvent[]): string {
  const serialized = JSON.stringify(toolEvents);
  const tokenCount = estimateTokens(serialized);

  if (tokenCount <= MAX_THREAD_TOKENS) {
    return serialized;
  }

  // Prune strategy: remove raw data from older events, keep stats
  const pruned = toolEvents.map((event, index) => {
    if (index < toolEvents.length - 2) {  // Keep last 2 full
      return {
        status_code: event.status_code,
        operation: event.operation,
        n_turn: event.n_turn,
        stats: event.stats,
        data: '[pruned - see stats]'
      };
    }
    return event;
  });

  return JSON.stringify(pruned);
}
