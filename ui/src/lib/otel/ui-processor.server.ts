/**
 * UI Span Processor - Server Only
 *
 * Custom SpanProcessor that buffers spans for UI consumption.
 * Subscribers receive spans in real-time via SSE.
 */

import type { SpanProcessor, ReadableSpan } from '@opentelemetry/sdk-trace-base'
import type { Context } from '@opentelemetry/api'
import type { SpanData, SpanEvent, SpanStatus } from './types'
import { getLaneFromSpan } from './types'

// ============================================================================
// Configuration
// ============================================================================

const MAX_BUFFER_SIZE = 100
const HARNESS_PATTERNS_PREFIX = 'harness-patterns.'

// ============================================================================
// Span Transformer
// ============================================================================

function transformSpan(span: ReadableSpan): SpanData {
  const name = span.name
  const startTimeMs = hrTimeToMs(span.startTime)
  const endTimeMs = span.endTime ? hrTimeToMs(span.endTime) : undefined

  // Map OTel status to our status
  let status: SpanStatus = 'ok'
  if (span.status.code === 2) { // SpanStatusCode.ERROR
    status = 'error'
  } else if (!endTimeMs) {
    status = 'pending'
  }

  // Transform events
  const events: SpanEvent[] = span.events.map(e => ({
    name: e.name,
    time: hrTimeToMs(e.time),
    attributes: e.attributes as Record<string, unknown> | undefined
  }))

  // parentSpanId is available on the span object directly
  const parentId = (span as unknown as { parentSpanId?: string }).parentSpanId

  return {
    id: span.spanContext().spanId,
    traceId: span.spanContext().traceId,
    parentId,
    name,
    status,
    startTime: startTimeMs,
    endTime: endTimeMs,
    duration_ms: endTimeMs ? endTimeMs - startTimeMs : undefined,
    attributes: span.attributes as Record<string, unknown>,
    events,
    lane: getLaneFromSpan(name)
  }
}

/** Convert OTel HrTime [seconds, nanoseconds] to milliseconds */
function hrTimeToMs(hrTime: [number, number]): number {
  return hrTime[0] * 1000 + hrTime[1] / 1_000_000
}

// ============================================================================
// UI Span Processor
// ============================================================================

export type SpanSubscriber = (span: SpanData) => void

class UISpanProcessor implements SpanProcessor {
  private buffer: SpanData[] = []
  private subscribers = new Set<SpanSubscriber>()

  /**
   * Called when a span is started.
   * We don't emit here - wait for span to end.
   */
  onStart(_span: ReadableSpan, _parentContext: Context): void {
    // No-op: wait for onEnd
  }

  /**
   * Called when a span ends.
   * Transform and emit to subscribers.
   */
  onEnd(span: ReadableSpan): void {
    // Only process spans from harness-patterns
    // instrumentationScope replaced instrumentationLibrary in newer OTel SDK versions
    const scope = (span as unknown as { instrumentationLibrary?: { name: string }, instrumentationScope?: { name: string } })
    const tracerName = scope.instrumentationScope?.name ?? scope.instrumentationLibrary?.name ?? ''
    if (!tracerName.startsWith(HARNESS_PATTERNS_PREFIX)) {
      return
    }

    const data = transformSpan(span)

    // Add to buffer (ring buffer behavior)
    this.buffer.push(data)
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer.shift()
    }

    // Notify subscribers
    for (const subscriber of this.subscribers) {
      try {
        subscriber(data)
      } catch (e) {
        console.error('[UISpanProcessor] Subscriber error:', e)
      }
    }
  }

  /**
   * Subscribe to span events.
   * Returns unsubscribe function.
   */
  subscribe(callback: SpanSubscriber): () => void {
    this.subscribers.add(callback)
    return () => {
      this.subscribers.delete(callback)
    }
  }

  /**
   * Get buffered spans (for late-joining clients).
   */
  getBuffer(): SpanData[] {
    return [...this.buffer]
  }

  /**
   * Clear the buffer.
   */
  clearBuffer(): void {
    this.buffer = []
  }

  /**
   * Called when SDK is shutting down.
   */
  async shutdown(): Promise<void> {
    this.subscribers.clear()
    this.buffer = []
  }

  /**
   * Force flush any pending spans.
   */
  async forceFlush(): Promise<void> {
    // No batching, so nothing to flush
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const uiSpanProcessor = new UISpanProcessor()
