/**
 * Telemetry Stream Hook
 *
 * Connects to the SSE endpoint and populates the telemetry store.
 */

import { onMount, onCleanup } from 'solid-js'
import type { TelemetryStore } from './telemetry-store'
import type { SpanData } from './types'

// ============================================================================
// Hook
// ============================================================================

/**
 * Connect to telemetry SSE stream and populate store.
 *
 * @param store - TelemetryStore to populate
 *
 * @example
 * const store = createTelemetryStore()
 * useTelemetryStream(store)
 */
export function useTelemetryStream(store: TelemetryStore): void {
  let eventSource: EventSource | null = null
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null

  const connect = () => {
    eventSource = new EventSource('/api/telemetry/stream')

    eventSource.onopen = () => {
      console.log('[Telemetry] SSE connected')
    }

    eventSource.onmessage = (event) => {
      try {
        const span: SpanData = JSON.parse(event.data)
        store.addSpan(span)
      } catch (e) {
        console.error('[Telemetry] Failed to parse span:', e)
      }
    }

    eventSource.onerror = (e) => {
      console.error('[Telemetry] SSE error:', e)
      eventSource?.close()

      // Reconnect after 2 seconds
      reconnectTimeout = setTimeout(connect, 2000)
    }
  }

  onMount(() => {
    connect()
  })

  onCleanup(() => {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout)
    }
    eventSource?.close()
  })
}
