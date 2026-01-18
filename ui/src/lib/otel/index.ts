/**
 * OpenTelemetry Module - Public API
 */

// Types (client-safe)
export type {
  SpanData,
  SpanEvent,
  SpanStatus,
  SpanLane,
  TimelineEvent,
  TelemetryMetrics
} from './types'

export {
  statusColors,
  spanColors,
  getLaneFromSpan,
  getSpanColor,
  getSpanLabel
} from './types'

// Store (client-safe)
export { createTelemetryStore, type TelemetryStore } from './telemetry-store'

// Stream hook (client-safe)
export { useTelemetryStream } from './use-telemetry-stream'
