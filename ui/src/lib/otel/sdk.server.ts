/**
 * OpenTelemetry SDK Initialization - Server Only
 *
 * Initializes the OTel SDK with:
 * - Compact console exporter for terminal output
 * - UISpanProcessor for streaming to the UI
 */

import { NodeSDK } from '@opentelemetry/sdk-node'
import {
  SpanExporter,
  SimpleSpanProcessor,
  ReadableSpan
} from '@opentelemetry/sdk-trace-base'
import { SpanStatusCode } from '@opentelemetry/api'
import { uiSpanProcessor } from './ui-processor.server'

// ============================================================================
// Compact Console Exporter
// ============================================================================

const HARNESS_PREFIX = 'harness-patterns.'

/**
 * Clean, compact span exporter that only shows harness-patterns spans
 * with minimal, readable output.
 */
class CompactSpanExporter implements SpanExporter {
  export(spans: ReadableSpan[], resultCallback: (result: { code: number }) => void): void {
    for (const span of spans) {
      // Only log harness-patterns spans
      const scope = (span as unknown as { instrumentationScope?: { name: string } })
      const tracerName = scope.instrumentationScope?.name ?? ''
      if (!tracerName.startsWith(HARNESS_PREFIX)) continue

      const name = span.name
      const attrs = span.attributes
      const status = span.status
      const durationMs = Math.round((span.endTime[0] - span.startTime[0]) * 1000 +
        (span.endTime[1] - span.startTime[1]) / 1_000_000)

      // Format based on span type
      if (name === 'harness.run') {
        const sessionId = attrs['sessionId'] ?? 'unknown'
        console.log(`[harness] Session ${sessionId} completed in ${durationMs}ms`)
      } else if (name === 'router') {
        const route = attrs['route'] ?? 'none'
        const intent = attrs['intent'] ?? ''
        console.log(`[router] → ${route} (intent: "${intent}")`)
      } else if (name.startsWith('pattern.')) {
        const patternType = name.replace('pattern.', '')
        const patternId = attrs['patternId'] ?? patternType
        if (status.code === SpanStatusCode.ERROR) {
          console.log(`[${patternType}] ${patternId} ✗ ${status.message} (${durationMs}ms)`)
        } else {
          console.log(`[${patternType}] ${patternId} ✓ (${durationMs}ms)`)
        }
      } else if (name === 'controller') {
        const turn = attrs['turn'] ?? 0
        if (status.code === SpanStatusCode.ERROR) {
          console.log(`  [controller] turn ${turn} ✗ ${status.message}`)
        }
        // Don't log successful controller calls - too verbose
      } else if (name === 'tool.call') {
        const tool = attrs['tool'] ?? 'unknown'
        const success = attrs['success'] !== false
        if (success) {
          console.log(`  [tool] ${tool} ✓ (${durationMs}ms)`)
        } else {
          console.log(`  [tool] ${tool} ✗ ${attrs['error'] ?? 'failed'}`)
        }
      } else if (name === 'routing.routeMessage') {
        // Skip - router span is more informative
      }
    }
    resultCallback({ code: 0 })
  }

  shutdown(): Promise<void> {
    return Promise.resolve()
  }
}

// ============================================================================
// SDK Configuration
// ============================================================================

const sdk = new NodeSDK({
  serviceName: 'kg-agent',
  spanProcessors: [
    // Compact console output for terminal visibility
    new SimpleSpanProcessor(new CompactSpanExporter()),
    // Custom processor for UI streaming
    uiSpanProcessor
  ]
})

// ============================================================================
// Start SDK
// ============================================================================

sdk.start()

console.log('[OTel] SDK initialized with CompactSpanExporter + UISpanProcessor')

// ============================================================================
// Graceful Shutdown
// ============================================================================

process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.log('[OTel] SDK shut down'))
    .catch((err) => console.error('[OTel] Shutdown error:', err))
    .finally(() => process.exit(0))
})

export { sdk }
