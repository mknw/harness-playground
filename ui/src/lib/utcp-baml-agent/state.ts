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
// Event Types
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
