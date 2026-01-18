/**
 * Telemetry Stream SSE Endpoint
 *
 * Server-Sent Events endpoint for real-time span streaming.
 * Clients connect via EventSource and receive spans as they complete.
 */

import type { APIEvent } from '@solidjs/start/server'
import { uiSpanProcessor } from '~/lib/otel/ui-processor.server'

/**
 * GET /api/telemetry/stream
 *
 * SSE endpoint that streams OTel spans to connected clients.
 */
export function GET(_event: APIEvent): Response {
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null

  const stream = new ReadableStream({
    start(controller) {
      // Send buffered spans first (for late-joining clients)
      const buffered = uiSpanProcessor.getBuffer()
      for (const span of buffered) {
        const data = `data: ${JSON.stringify(span)}\n\n`
        controller.enqueue(encoder.encode(data))
      }

      // Subscribe to new spans
      unsubscribe = uiSpanProcessor.subscribe((span) => {
        try {
          const data = `data: ${JSON.stringify(span)}\n\n`
          controller.enqueue(encoder.encode(data))
        } catch {
          // Stream closed - will be cleaned up in cancel
        }
      })
    },

    cancel() {
      // Client disconnected - cleanup subscription
      unsubscribe?.()
      console.log('[Telemetry SSE] Client disconnected')
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  })
}
