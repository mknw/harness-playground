/**
 * Telemetry Store
 *
 * Reactive Solid.js store for OTel span data.
 * Used by ObservabilityPanel for real-time display.
 */

import { createStore, produce } from 'solid-js/store'
import { createMemo } from 'solid-js'
import type { SpanData, TelemetryMetrics, SpanLane } from './types'

// ============================================================================
// Store Types
// ============================================================================

interface TelemetryState {
  spans: SpanData[]
  expandedSpanId: string | null
}

export interface TelemetryStore {
  state: TelemetryState
  addSpan: (span: SpanData) => void
  clearSpans: () => void
  expandSpan: (id: string) => void
  collapseSpan: () => void
  deleteSpan: (id: string) => void
  getSpan: (id: string) => SpanData | undefined
  metrics: () => TelemetryMetrics
}

// ============================================================================
// Store Factory
// ============================================================================

export function createTelemetryStore(): TelemetryStore {
  const [state, setState] = createStore<TelemetryState>({
    spans: [],
    expandedSpanId: null
  })

  // ============================================================================
  // Computed Metrics
  // ============================================================================

  const metrics = createMemo((): TelemetryMetrics => {
    const spans = state.spans

    if (spans.length === 0) {
      return {
        totalCalls: 0,
        successRate: 0,
        avgLatency_ms: 0,
        callsByLane: { interface: 0, tools: 0 }
      }
    }

    const successCount = spans.filter(s => s.status === 'ok').length
    const durations = spans
      .map(s => s.duration_ms)
      .filter((d): d is number => d !== undefined)

    const callsByLane: Record<SpanLane, number> = { interface: 0, tools: 0 }
    for (const span of spans) {
      callsByLane[span.lane]++
    }

    return {
      totalCalls: spans.length,
      successRate: successCount / spans.length,
      avgLatency_ms: durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0,
      callsByLane
    }
  })

  // ============================================================================
  // Actions
  // ============================================================================

  const addSpan = (span: SpanData) => {
    setState(produce(s => {
      // Check for duplicate (update existing span)
      const idx = s.spans.findIndex(existing => existing.id === span.id)
      if (idx >= 0) {
        s.spans[idx] = span
      } else {
        s.spans.push(span)
      }
    }))
  }

  const clearSpans = () => {
    setState({ spans: [], expandedSpanId: null })
  }

  const expandSpan = (id: string) => {
    setState({ expandedSpanId: id })
  }

  const collapseSpan = () => {
    setState({ expandedSpanId: null })
  }

  const deleteSpan = (id: string) => {
    setState(produce(s => {
      s.spans = s.spans.filter(span => span.id !== id)
      if (s.expandedSpanId === id) {
        s.expandedSpanId = null
      }
    }))
  }

  const getSpan = (id: string): SpanData | undefined => {
    return state.spans.find(s => s.id === id)
  }

  return {
    state,
    addSpan,
    clearSpans,
    expandSpan,
    collapseSpan,
    deleteSpan,
    getSpan,
    metrics
  }
}
