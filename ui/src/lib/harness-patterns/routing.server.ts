/**
 * Routing - Server Only
 *
 * Routes user messages to appropriate tool namespaces.
 */

import { assertServerOnImport } from './assert.server'
import { trace, SpanStatusCode } from '@opentelemetry/api'

assertServerOnImport()

const tracer = trace.getTracer('harness-patterns.routing')

// ============================================================================
// BAML Import Helper
// ============================================================================

async function getBAML() {
  const { b } = await import('../../../baml_client')
  return b
}

// ============================================================================
// Routing
// ============================================================================

export async function routeMessageOp(
  message: string,
  history: Array<{ role: string; content: string }>
): Promise<{
  intent: string
  tool_call_needed: boolean
  tool_name: 'neo4j' | 'web_search' | 'code_mode' | null
  response_text: string
}> {
  return tracer.startActiveSpan('routing.routeMessage', async (span) => {
    span.setAttribute('historyLength', history.length)

    try {
      const b = await getBAML()
      const result = await b.RouteUserMessage(message, history)

      const namespaceMap: Record<string, 'neo4j' | 'web_search' | 'code_mode'> = {
        Neo4j: 'neo4j',
        WebSearch: 'web_search',
        CodeMode: 'code_mode'
      }

      span.setStatus({ code: SpanStatusCode.OK })
      return {
        intent: result.intent,
        tool_call_needed: result.tool_call_needed,
        tool_name: result.tool_name
          ? namespaceMap[result.tool_name] ?? null
          : null,
        response_text: result.response_text
      }
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error)
      })
      throw error
    } finally {
      span.end()
    }
  })
}
