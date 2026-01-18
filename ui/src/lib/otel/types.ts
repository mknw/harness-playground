/**
 * OpenTelemetry UI Types
 *
 * Types for displaying OTel spans in the ObservabilityPanel.
 */

// ============================================================================
// Core Span Types
// ============================================================================

/** Span status */
export type SpanStatus = 'ok' | 'error' | 'pending'

/** UI lane assignment */
export type SpanLane = 'interface' | 'tools'

/** Span data transformed for UI consumption */
export interface SpanData {
  id: string
  traceId: string
  parentId?: string
  name: string
  status: SpanStatus
  startTime: number
  endTime?: number
  duration_ms?: number
  attributes: Record<string, unknown>
  events: SpanEvent[]
  lane: SpanLane
}

/** Span event */
export interface SpanEvent {
  name: string
  time: number
  attributes?: Record<string, unknown>
}

// ============================================================================
// Timeline Types (for ObservabilityPanel)
// ============================================================================

/** Timeline event for two-lane display */
export type TimelineEvent = SpanData

// ============================================================================
// Metrics
// ============================================================================

/** Aggregated metrics */
export interface TelemetryMetrics {
  totalCalls: number
  successRate: number
  avgLatency_ms: number
  callsByLane: Record<SpanLane, number>
}

// ============================================================================
// Color Mappings
// ============================================================================

/** Status to color class mapping */
export const statusColors: Record<SpanStatus, string> = {
  pending: 'neon-yellow',
  ok: 'neon-green',
  error: 'red-500'
}

/** Span name patterns to colors */
export const spanColors: Record<string, string> = {
  // Interface lane - harness orchestration
  'harness.run': '#6366f1',        // indigo
  'harness.resume': '#6366f1',

  // Router
  'router': '#8b5cf6',             // purple
  'routing.routeMessage': '#8b5cf6',

  // Patterns
  'pattern.simpleLoop': '#00ffff', // cyan
  'pattern.actorCritic': '#ff6600', // orange
  'pattern.withApproval': '#fbbf24', // yellow

  // Deciders
  'decider.neo4j': '#00ffff',      // cyan
  'decider.webSearch': '#9d00ff',  // purple
  'decider.codeMode': '#ff6600',   // orange

  // Default
  'default': '#6b7280'             // gray
}

// ============================================================================
// Display Helpers
// ============================================================================

/** Determine lane from span name */
export function getLaneFromSpan(name: string): SpanLane {
  if (name.startsWith('harness.') || name === 'router') {
    return 'interface'
  }
  return 'tools'
}

/** Get hex color for span */
export function getSpanColor(name: string): string {
  // Exact match
  if (spanColors[name]) {
    return spanColors[name]
  }

  // Prefix match
  for (const [prefix, color] of Object.entries(spanColors)) {
    if (name.startsWith(prefix)) {
      return color
    }
  }

  return spanColors['default']
}

/** Get display label for span */
export function getSpanLabel(name: string): string {
  // Remove common prefixes for cleaner display
  const labels: Record<string, string> = {
    'harness.run': 'Harness',
    'harness.resume': 'Resume',
    'router': 'Router',
    'routing.routeMessage': 'Route',
    'pattern.simpleLoop': 'Loop',
    'pattern.actorCritic': 'Actor-Critic',
    'pattern.withApproval': 'Approval',
    'decider.neo4j': 'Neo4j Plan',
    'decider.webSearch': 'Search Plan',
    'decider.codeMode': 'Code Plan'
  }

  return labels[name] || name.split('.').pop() || name
}
