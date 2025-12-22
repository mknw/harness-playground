/**
 * Execution Patterns - Server Only
 *
 * Composable loop patterns with OpenTelemetry instrumentation.
 */

import { assertServerOnImport } from './assert.server';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { callTool } from './mcp-client.server';
import type {
  PlannerContext,
  PatternResult,
  ToolEvent,
  ToolExecutionPlan,
  ScriptExecutionEvent,
  ExitReason
} from './types';
import {
  neo4jOp,
  webSearchOp,
  codePlannerOp,
  evaluateScriptOp,
  createResponseOp
} from './planners.server';

assertServerOnImport();

const tracer = trace.getTracer('harness-patterns.patterns');
const DEFAULT_MAX_TURNS = 5;

// ============================================================================
// Tool Execution Helper
// ============================================================================

async function executeTool(
  plan: ToolExecutionPlan,
  turn: number
): Promise<ToolEvent> {
  return tracer.startActiveSpan('mcp.callTool', async (span) => {
    span.setAttribute('tool', plan.toolName);
    span.setAttribute('turn', turn);

    const startTime = Date.now();

    try {
      const args = JSON.parse(plan.payload);
      const result = await callTool(plan.toolName, args);

      span.setStatus({ code: SpanStatusCode.OK });

      return {
        status_code: result.success ? 200 : 500,
        status_description: result.success ? 'Success' : (result.error ?? 'Failed'),
        operation: plan.payload,
        data: result.data,
        n_turn: turn,
        stats: { duration_ms: Date.now() - startTime }
      };
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error)
      });

      return {
        status_code: 500,
        status_description: error instanceof Error ? error.message : String(error),
        operation: plan.payload,
        data: null,
        n_turn: turn,
        stats: { duration_ms: Date.now() - startTime }
      };
    } finally {
      span.end();
    }
  });
}

// ============================================================================
// Pattern 1: Simple Loop
// ============================================================================

export interface SimpleLoopOptions {
  namespace: 'neo4j' | 'web_search';
  maxTurns?: number;
  schema?: string; // Required for neo4j
}

export async function simpleLoop(
  userMessage: string,
  intent: string,
  options: SimpleLoopOptions
): Promise<PatternResult> {
  return tracer.startActiveSpan('pattern.simpleLoop', async (span) => {
    span.setAttribute('pattern.type', 'simpleLoop');
    span.setAttribute('pattern.namespace', options.namespace);
    span.setAttribute('pattern.maxTurns', options.maxTurns ?? DEFAULT_MAX_TURNS);

    const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
    const toolEvents: ToolEvent[] = [];
    let exitReason: ExitReason = 'max_turns';

    try {
      for (let turn = 1; turn <= maxTurns; turn++) {
        const ctx: PlannerContext = {
          intent,
          previousResults: toolEvents,
          turn
        };

        // Plan next action
        let plan: ToolExecutionPlan;
        if (options.namespace === 'neo4j') {
          plan = await neo4jOp(ctx, userMessage, options.schema ?? '');
        } else {
          plan = await webSearchOp(ctx, userMessage);
        }

        // Check for Return
        if (plan.isReturn) {
          exitReason = 'return';
          break;
        }

        // Execute tool
        const event = await executeTool(plan, turn);
        toolEvents.push(event);

        // Check for error
        if (event.status_code !== 200) {
          exitReason = 'error';
          break;
        }
      }

      span.setStatus({ code: SpanStatusCode.OK });

      return {
        toolEvents,
        finalResult: toolEvents[toolEvents.length - 1]?.data ?? null,
        metadata: {
          turnsUsed: toolEvents.length,
          exitReason
        }
      };
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

// ============================================================================
// Pattern 2: Executor-Evaluator Loop
// ============================================================================

export interface ExecutorEvaluatorOptions {
  maxTurns?: number;
  availableTools: string[];
}

export async function executorEvaluatorLoop(
  userMessage: string,
  intent: string,
  options: ExecutorEvaluatorOptions
): Promise<PatternResult> {
  return tracer.startActiveSpan('pattern.executorEvaluatorLoop', async (span) => {
    span.setAttribute('pattern.type', 'executorEvaluatorLoop');
    span.setAttribute('pattern.maxTurns', options.maxTurns ?? DEFAULT_MAX_TURNS);
    span.setAttribute('pattern.toolCount', options.availableTools.length);

    const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
    const toolEvents: ToolEvent[] = [];
    const scriptEvents: ScriptExecutionEvent[] = [];
    let exitReason: ExitReason = 'max_turns';

    try {
      for (let turn = 1; turn <= maxTurns; turn++) {
        const ctx: PlannerContext = {
          intent,
          previousResults: toolEvents,
          turn
        };

        // Execute: Generate and run script
        const plan = await codePlannerOp(ctx, userMessage, options.availableTools);
        const event = await executeTool(plan, turn);
        toolEvents.push(event);

        // Track script execution
        const payload = JSON.parse(plan.payload);
        scriptEvents.push({
          script: payload.script ?? '',
          output: event.status_code === 200 ? JSON.stringify(event.data) : '',
          error: event.status_code !== 200 ? event.status_description : null
        });

        // Evaluate: Check if sufficient
        const evaluation = await evaluateScriptOp(intent, scriptEvents);

        if (evaluation.is_sufficient) {
          exitReason = 'return';
          break;
        }

        // If error, might want to stop
        if (event.status_code !== 200) {
          exitReason = 'error';
          break;
        }
      }

      span.setStatus({ code: SpanStatusCode.OK });

      return {
        toolEvents,
        finalResult: toolEvents[toolEvents.length - 1]?.data ?? null,
        metadata: {
          turnsUsed: toolEvents.length,
          exitReason
        }
      };
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

// ============================================================================
// Pattern 3: Code Mode Loop (alias for executor-evaluator)
// ============================================================================

export async function codeModeLoop(
  userMessage: string,
  intent: string,
  availableTools: string[],
  maxTurns?: number
): Promise<PatternResult> {
  return executorEvaluatorLoop(userMessage, intent, {
    maxTurns,
    availableTools
  });
}

// ============================================================================
// Response Wrapper
// ============================================================================

export async function withResponse(
  patternResult: PatternResult,
  userMessage: string,
  intent: string
): Promise<PatternResult & { response: string }> {
  return tracer.startActiveSpan('pattern.withResponse', async (span) => {
    span.setAttribute('eventCount', patternResult.toolEvents.length);

    try {
      const response = await createResponseOp(
        patternResult.toolEvents,
        userMessage,
        intent
      );

      span.setStatus({ code: SpanStatusCode.OK });

      return {
        ...patternResult,
        response
      };
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      span.end();
    }
  });
}
