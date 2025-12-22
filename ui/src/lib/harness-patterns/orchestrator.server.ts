/**
 * Orchestrator - Server Only
 *
 * Base Orchestrator class designed for subclassing.
 * AgentOrchestrator is a simple default implementation.
 *
 * Telemetry is handled via OpenTelemetry spans, NOT in return values.
 */

import { assertServerOnImport, assertServer } from './assert.server';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { Thread } from './state.server';
import { listTools } from './mcp-client.server';
import { routeMessageOp } from './planners.server';
import {
  simpleLoop,
  codeModeLoop,
  withResponse
} from './patterns.server';
import type {
  OrchestratorResult,
  ToolExecutionPlan,
  PatternResult,
  ToolEvent
} from './types';

assertServerOnImport();

const tracer = trace.getTracer('harness-patterns.orchestrator');

// ============================================================================
// Base Orchestrator Class (Abstract)
// ============================================================================

/**
 * Base Orchestrator class - designed for subclassing.
 * Users can extend this to create custom orchestrators.
 *
 * @example
 * ```typescript
 * class MyOrchestrator extends Orchestrator {
 *   async processMessage(message: string): Promise<OrchestratorResult> {
 *     // Custom routing/pattern logic
 *     return this.buildResult('response', []);
 *   }
 * }
 * ```
 */
export abstract class Orchestrator {
  protected thread: Thread;
  protected pendingPlan: ToolExecutionPlan | null = null;

  constructor() {
    assertServer();
    this.thread = new Thread();
  }

  /**
   * Process a user message - main entry point.
   * Subclasses implement their own routing and pattern execution.
   */
  abstract processMessage(message: string): Promise<OrchestratorResult>;

  /**
   * Check if there's a pending approval
   */
  hasPendingApproval(): boolean {
    return this.pendingPlan !== null;
  }

  /**
   * Approve pending operation
   */
  async approveOperation(): Promise<OrchestratorResult> {
    return tracer.startActiveSpan('orchestrator.approveOperation', async (span) => {
      if (!this.pendingPlan) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: 'No pending plan' });
        span.end();
        throw new Error('No pending operation to approve');
      }

      try {
        this.thread.addApprovalResponse(true);

        // Execute the pending plan
        const { callTool } = await import('./mcp-client.server');
        const args = JSON.parse(this.pendingPlan.payload);
        const result = await callTool(this.pendingPlan.toolName, args);

        const toolEvent: ToolEvent = {
          status_code: result.success ? 200 : 500,
          status_description: result.success ? 'Success' : (result.error || 'Failed'),
          operation: this.pendingPlan.payload,
          data: result.data,
          n_turn: 1
        };

        const response = result.success
          ? `Operation completed successfully.`
          : `Operation failed: ${result.error}`;

        this.thread.addAssistantMessage(response);
        this.pendingPlan = null;

        span.setStatus({ code: SpanStatusCode.OK });

        return this.buildResult(response, [toolEvent]);
      } finally {
        span.end();
      }
    });
  }

  /**
   * Reject pending operation
   */
  async rejectOperation(reason?: string): Promise<OrchestratorResult> {
    this.thread.addApprovalResponse(false, reason);
    this.pendingPlan = null;

    const response = reason
      ? `Operation cancelled: ${reason}`
      : 'Operation cancelled.';

    this.thread.addAssistantMessage(response);

    return this.buildResult(response, []);
  }

  /**
   * Clear conversation history
   */
  clearConversation(): void {
    this.thread = new Thread();
    this.pendingPlan = null;
  }

  /**
   * Build result - NO telemetry, just response and toolEvents.
   * OTel spans handle all telemetry.
   */
  protected buildResult(response: string, toolEvents: ToolEvent[]): OrchestratorResult {
    return {
      response,
      toolEvents: toolEvents.length > 0 ? toolEvents : undefined
    };
  }
}

// ============================================================================
// Agent Orchestrator (Default Implementation)
// ============================================================================

/**
 * Default agent orchestrator - simple subclass.
 * Routes messages to appropriate patterns based on intent.
 */
export class AgentOrchestrator extends Orchestrator {
  /**
   * Process a user message - routes to appropriate pattern.
   */
  async processMessage(message: string): Promise<OrchestratorResult> {
    return tracer.startActiveSpan('orchestrator.processMessage', async (span) => {
      span.setAttribute('messageLength', message.length);

      try {
        this.thread.addUserMessage(message);

        // Route message
        const routing = await routeMessageOp(
          message,
          this.thread.getRecentHistory(10)
        );

        span.setAttribute('intent', routing.intent);
        span.setAttribute('toolNeeded', routing.tool_call_needed);
        span.setAttribute('namespace', routing.tool_name ?? 'none');

        // No tool needed - return conversational response
        if (!routing.tool_call_needed) {
          this.thread.addAssistantMessage(routing.response_text);
          span.setStatus({ code: SpanStatusCode.OK });

          return this.buildResult(routing.response_text, []);
        }

        // Execute appropriate pattern
        let patternResult: PatternResult;

        switch (routing.tool_name) {
          case 'neo4j':
            patternResult = await simpleLoop(message, routing.intent, {
              namespace: 'neo4j',
              schema: await this.getSchema()
            });
            break;

          case 'web_search':
            patternResult = await simpleLoop(message, routing.intent, {
              namespace: 'web_search'
            });
            break;

          case 'code_mode': {
            const tools = await listTools();
            patternResult = await codeModeLoop(
              message,
              routing.intent,
              tools.map((t) => t.name)
            );
            break;
          }

          default:
            throw new Error(`Unknown namespace: ${routing.tool_name}`);
        }

        // Check for approval needed (write operations)
        const lastPlan = this.extractLastPlan(patternResult);
        if (lastPlan && lastPlan.toolName.includes('write')) {
          this.pendingPlan = lastPlan;
          span.setStatus({ code: SpanStatusCode.OK });

          return {
            response: `This operation requires approval:\n\n${lastPlan.description}`,
            toolEvents: patternResult.toolEvents,
            needsApproval: true,
            pendingPlan: lastPlan
          };
        }

        // Generate response
        const resultWithResponse = await withResponse(
          patternResult,
          message,
          routing.intent
        );

        const fullResponse = routing.response_text
          ? `${routing.response_text}\n\n${resultWithResponse.response}`
          : resultWithResponse.response;

        this.thread.addAssistantMessage(fullResponse);
        span.setStatus({ code: SpanStatusCode.OK });

        return this.buildResult(fullResponse, patternResult.toolEvents);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.thread.addError(errorMessage);

        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: errorMessage
        });

        return this.buildResult(`Error: ${errorMessage}`, []);
      } finally {
        span.end();
      }
    });
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private async getSchema(): Promise<string> {
    const { callTool } = await import('./mcp-client.server');
    const result = await callTool('get_neo4j_schema', {});
    return result.success ? JSON.stringify(result.data) : '';
  }

  private extractLastPlan(result: PatternResult): ToolExecutionPlan | null {
    const lastEvent = result.toolEvents[result.toolEvents.length - 1];
    if (!lastEvent) return null;

    // Reconstruct plan from event
    return {
      reasoning: '',
      toolName: '',
      payload: lastEvent.operation,
      description: '',
      isReturn: false
    };
  }
}
