/**
 * BAML Planner Wrappers - Server Only
 *
 * Wraps BAML functions with OpenTelemetry spans.
 * Converts BAML outputs to normalized ToolExecutionPlan.
 */

import { assertServerOnImport } from './assert.server';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import type {
  PlannerContext,
  ToolExecutionPlan,
  ToolEvent,
  ScriptExecutionEvent,
  ScriptEvaluationResult
} from './types';

assertServerOnImport();

const tracer = trace.getTracer('harness-patterns.planners');

// ============================================================================
// Code Mode Tool Name
// ============================================================================

const CODE_MODE_TOOL_NAME = 'code-mode-kg-agent-executor';

// ============================================================================
// BAML Import Helper
// ============================================================================

async function getBAML() {
  const { b } = await import('../../../baml_client');
  return b;
}

// ============================================================================
// Plan Converters
// ============================================================================

function fromNeo4jPlan(plan: {
  reasoning: string;
  tool_name: string;
  payload?: { query: string } | null;
  description: string;
}): ToolExecutionPlan {
  const toolMap: Record<string, string> = {
    Read: 'read_neo4j_cypher',
    Write: 'write_neo4j_cypher',
    Schema: 'get_neo4j_schema',
    Return: 'Return'
  };

  return {
    reasoning: plan.reasoning,
    toolName: toolMap[plan.tool_name] ?? plan.tool_name,
    payload: plan.payload ? JSON.stringify(plan.payload) : '{}',
    description: plan.description,
    isReturn: plan.tool_name === 'Return'
  };
}

function fromWebSearchPlan(plan: {
  reasoning: string;
  tool_name: string;
  payload?: { query?: string; url?: string } | null;
  description: string;
}): ToolExecutionPlan {
  const toolMap: Record<string, string> = {
    Search: 'search',
    Fetch: 'fetch',
    Return: 'Return'
  };

  return {
    reasoning: plan.reasoning,
    toolName: toolMap[plan.tool_name] ?? plan.tool_name,
    payload: plan.payload ? JSON.stringify(plan.payload) : '{}',
    description: plan.description,
    isReturn: plan.tool_name === 'Return'
  };
}

function fromMCPScriptPlan(plan: {
  reasoning: string;
  script: string;
  description: string;
}): ToolExecutionPlan {
  return {
    reasoning: plan.reasoning,
    toolName: CODE_MODE_TOOL_NAME,
    payload: JSON.stringify({ script: plan.script }),
    description: plan.description,
    isReturn: false
  };
}

// ============================================================================
// Planner Operations
// ============================================================================

export async function neo4jOp(
  ctx: PlannerContext,
  threadXml: string,
  schema: string
): Promise<ToolExecutionPlan> {
  return tracer.startActiveSpan('planner.neo4jOp', async (span) => {
    span.setAttribute('turn', ctx.turn);
    span.setAttribute('intent', ctx.intent);

    try {
      const b = await getBAML();
      const previousResults = JSON.stringify(ctx.previousResults);

      const plan = await b.PlanNeo4jOperation(
        threadXml,
        ctx.intent,
        schema,
        previousResults,
        ctx.turn
      );

      span.setStatus({ code: SpanStatusCode.OK });
      return fromNeo4jPlan(plan);
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

export async function webSearchOp(
  ctx: PlannerContext,
  threadXml: string
): Promise<ToolExecutionPlan> {
  return tracer.startActiveSpan('planner.webSearchOp', async (span) => {
    span.setAttribute('turn', ctx.turn);
    span.setAttribute('intent', ctx.intent);

    try {
      const b = await getBAML();
      const previousResults = JSON.stringify(ctx.previousResults);

      const plan = await b.PlanWebSearch(
        threadXml,
        ctx.intent,
        previousResults,
        ctx.turn
      );

      span.setStatus({ code: SpanStatusCode.OK });
      return fromWebSearchPlan(plan);
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

export async function codePlannerOp(
  ctx: PlannerContext,
  threadXml: string,
  availableTools: string[]
): Promise<ToolExecutionPlan> {
  return tracer.startActiveSpan('planner.codePlannerOp', async (span) => {
    span.setAttribute('turn', ctx.turn);
    span.setAttribute('intent', ctx.intent);
    span.setAttribute('toolCount', availableTools.length);

    try {
      const b = await getBAML();

      // Convert previous results to ScriptExecutionEvent format
      const previousAttempts: ScriptExecutionEvent[] = ctx.previousResults
        .filter((e) => e.operation)
        .map((e) => {
          try {
            const payload = JSON.parse(e.operation);
            return {
              script: payload.script ?? '',
              output: e.status_code === 200 ? JSON.stringify(e.data) : '',
              error: e.status_code !== 200 ? e.status_description : null
            };
          } catch {
            return { script: '', output: '', error: null };
          }
        })
        .filter((e) => e.script);

      const plan = await b.ExecuteMCPScript(
        threadXml,
        ctx.intent,
        availableTools,
        previousAttempts
      );

      span.setStatus({ code: SpanStatusCode.OK });
      return fromMCPScriptPlan(plan);
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

export async function evaluateScriptOp(
  intent: string,
  events: ScriptExecutionEvent[]
): Promise<ScriptEvaluationResult> {
  return tracer.startActiveSpan('planner.evaluateScriptOp', async (span) => {
    span.setAttribute('intent', intent);
    span.setAttribute('attemptCount', events.length);

    try {
      const b = await getBAML();
      const result = await b.EvaluateScriptOutput(intent, events);

      span.setStatus({ code: SpanStatusCode.OK });
      return {
        is_sufficient: result.is_sufficient,
        explanation: result.explanation,
        suggested_approach: result.suggested_approach ?? null
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

export async function createResponseOp(
  toolEvents: ToolEvent[],
  userMessage: string,
  intent: string
): Promise<string> {
  return tracer.startActiveSpan('planner.createResponseOp', async (span) => {
    span.setAttribute('intent', intent);
    span.setAttribute('eventCount', toolEvents.length);

    try {
      const b = await getBAML();
      const response = await b.CreateToolResponse(
        JSON.stringify(toolEvents),
        userMessage,
        intent
      );

      span.setStatus({ code: SpanStatusCode.OK });
      return response;
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

export async function routeMessageOp(
  message: string,
  history: Array<{ role: string; content: string }>
): Promise<{
  intent: string;
  tool_call_needed: boolean;
  tool_name: 'neo4j' | 'web_search' | 'code_mode' | null;
  response_text: string;
}> {
  return tracer.startActiveSpan('planner.routeMessageOp', async (span) => {
    span.setAttribute('historyLength', history.length);

    try {
      const b = await getBAML();
      const result = await b.RouteUserMessage(message, history);

      const namespaceMap: Record<string, 'neo4j' | 'web_search' | 'code_mode'> =
        {
          Neo4j: 'neo4j',
          WebSearch: 'web_search',
          CodeMode: 'code_mode'
        };

      span.setStatus({ code: SpanStatusCode.OK });
      return {
        intent: result.intent,
        tool_call_needed: result.tool_call_needed,
        tool_name: result.tool_name
          ? namespaceMap[result.tool_name] ?? null
          : null,
        response_text: result.response_text
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
