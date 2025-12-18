/**
 * Agent Orchestrator - Server Only
 *
 * High-level API that returns response + telemetry to client.
 */

import { assertServerOnImport, assertServer } from './assert.server';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { Thread } from './state.server';
import { listTools } from './mcp-client.server';
import { routeMessageOp } from './planners.server';
import {
  simpleLoop,
  codeModeLoop,
  withResponse,
  type SimpleLoopOptions
} from './patterns.server';
import type {
  OrchestratorResult,
  TelemetrySummary,
  ToolExecutionPlan,
  PatternResult,
  ExitReason
} from './types';

assertServerOnImport();

const tracer = trace.getTracer('harness-patterns.orchestrator');

// ============================================================================
// Orchestrator Class
// ============================================================================

export class AgentOrchestrator {
  private thread: Thread;
  private pendingPlan: ToolExecutionPlan | null = null;
  private startTime: number = 0;

  constructor() {
    assertServer();
    this.thread = new Thread();
  }

  /**
   * Process a user message - main entry point.
   * Routes to appropriate pattern based on intent.
   */
  async processMessage(message: string): Promise<OrchestratorResult> {
    return tracer.startActiveSpan('orchestrator.processMessage', async (span) => {
      this.startTime = Date.now();
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

          return this.buildResult(routing.response_text, {
            toolEvents: [],
            finalResult: null,
            metadata: { turnsUsed: 0, exitReason: 'return' }
          });
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

          case 'code_mode':
            const tools = await listTools();
            patternResult = await codeModeLoop(
              message,
              routing.intent,
              tools.map((t) => t.name)
            );
            break;

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
            telemetry: this.buildTelemetry(patternResult),
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

        return this.buildResult(fullResponse, patternResult);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.thread.addError(errorMessage);

        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: errorMessage
        });

        return {
          response: `Error: ${errorMessage}`,
          telemetry: {
            totalDuration_ms: Date.now() - this.startTime,
            turnsUsed: 0,
            toolCalls: 0,
            exitReason: 'error' as ExitReason
          }
        };
      } finally {
        span.end();
      }
    });
  }

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

        const response = result.success
          ? `Operation completed successfully.`
          : `Operation failed: ${result.error}`;

        this.thread.addAssistantMessage(response);
        this.pendingPlan = null;

        span.setStatus({ code: SpanStatusCode.OK });

        return {
          response,
          telemetry: {
            totalDuration_ms: Date.now() - this.startTime,
            turnsUsed: 1,
            toolCalls: 1,
            exitReason: (result.success ? 'return' : 'error') as ExitReason
          }
        };
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

    return {
      response,
      telemetry: {
        totalDuration_ms: Date.now() - this.startTime,
        turnsUsed: 0,
        toolCalls: 0,
        exitReason: 'return' as ExitReason
      }
    };
  }

  /**
   * Clear conversation history
   */
  clearConversation(): void {
    this.thread = new Thread();
    this.pendingPlan = null;
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private async getSchema(): Promise<string> {
    const { callTool } = await import('./mcp-client.server');
    const result = await callTool('get_neo4j_schema', {});
    return result.success ? JSON.stringify(result.data) : '';
  }

  private buildTelemetry(result: PatternResult): TelemetrySummary {
    return {
      totalDuration_ms: Date.now() - this.startTime,
      turnsUsed: result.metadata.turnsUsed,
      toolCalls: result.toolEvents.length,
      exitReason: result.metadata.exitReason
    };
  }

  private buildResult(
    response: string,
    patternResult: PatternResult
  ): OrchestratorResult {
    return {
      response,
      telemetry: this.buildTelemetry(patternResult)
    };
  }

  private extractLastPlan(result: PatternResult): ToolExecutionPlan | null {
    const lastEvent = result.toolEvents[result.toolEvents.length - 1];
    if (!lastEvent) return null;

    // Reconstruct plan from event
    return {
      reasoning: '',
      toolName: '', // Would need to track this properly
      payload: lastEvent.operation,
      description: '',
      isReturn: false
    };
  }
}
