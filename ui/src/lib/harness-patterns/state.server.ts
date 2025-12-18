/**
 * Thread State Management - Server Only
 *
 * Event-based thread state for agent conversation history.
 * Following the 12-factor-agents pattern.
 */

import { assertServerOnImport } from './assert.server';
import type {
  ThreadEvent,
  SerializedThread,
  ToolEvent,
  ToolExecutionPlan
} from './types';

assertServerOnImport();

// ============================================================================
// Constants
// ============================================================================

const MAX_THREAD_TOKENS = 8000;

// ============================================================================
// Thread Class
// ============================================================================

export class Thread {
  private events: ThreadEvent[] = [];

  constructor(initialEvents: ThreadEvent[] = []) {
    this.events = initialEvents;
  }

  private addEvent(
    type: ThreadEvent['type'],
    data: unknown
  ): void {
    this.events.push({
      type,
      timestamp: new Date().toISOString(),
      data
    });
  }

  addUserMessage(content: string): void {
    this.addEvent('user_message', { content });
  }

  addAssistantMessage(content: string): void {
    this.addEvent('assistant_message', { content });
  }

  addToolCall(tool: string, parameters: Record<string, unknown>): void {
    this.addEvent('tool_call', { tool, parameters });
  }

  addToolResponse(tool: string, result: unknown): void {
    this.addEvent('tool_response', { tool, result });
  }

  addApprovalRequest(query: string, explanation: string): void {
    this.addEvent('approval_request', { query, explanation });
  }

  addApprovalResponse(approved: boolean, reason?: string): void {
    this.addEvent('approval_response', { approved, reason });
  }

  addError(error: string): void {
    this.addEvent('error', { error });
  }

  getLastUserMessage(): string | undefined {
    const event = [...this.events]
      .reverse()
      .find((e) => e.type === 'user_message');
    return (event?.data as { content?: string })?.content;
  }

  hasPendingApproval(): boolean {
    const lastRequest = [...this.events]
      .reverse()
      .find((e) => e.type === 'approval_request');
    if (!lastRequest) return false;

    const lastResponse = [...this.events]
      .reverse()
      .find((e) => e.type === 'approval_response');
    if (!lastResponse) return true;

    return new Date(lastRequest.timestamp) > new Date(lastResponse.timestamp);
  }

  /**
   * Serialize for LLM context (XML-like format)
   */
  serializeForLLM(): string {
    return this.events
      .map((event) => {
        const content =
          typeof event.data === 'object'
            ? JSON.stringify(event.data)
            : String(event.data);
        return `<${event.type}>${content}</${event.type}>`;
      })
      .join('\n');
  }

  /**
   * Get recent conversation messages for BAML
   */
  getRecentHistory(maxItems = 10): Array<{ role: string; content: string }> {
    return this.events
      .filter(
        (e) => e.type === 'user_message' || e.type === 'assistant_message'
      )
      .slice(-maxItems)
      .map((e) => ({
        role: e.type === 'user_message' ? 'user' : 'assistant',
        content: (e.data as { content: string }).content
      }));
  }

  toJSON(): SerializedThread {
    return this.events;
  }

  static fromJSON(events: SerializedThread): Thread {
    return new Thread(events);
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function requiresApproval(plan: ToolExecutionPlan): boolean {
  return plan.toolName.toLowerCase().includes('write');
}

export function prepareResultsForContext(toolEvents: ToolEvent[]): string {
  const serialized = JSON.stringify(toolEvents);
  if (estimateTokens(serialized) <= MAX_THREAD_TOKENS) {
    return serialized;
  }

  // Prune older events, keep last 2 full
  const pruned = toolEvents.map((event, index) => {
    if (index < toolEvents.length - 2) {
      return {
        status_code: event.status_code,
        operation: event.operation,
        n_turn: event.n_turn,
        data: '[pruned]'
      };
    }
    return event;
  });

  return JSON.stringify(pruned);
}
