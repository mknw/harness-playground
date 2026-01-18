/**
 * ObservabilityPanel Component
 *
 * Vertical timeline display with two lanes:
 * - Interface Lane: Harness/Router spans
 * - Tools Lane: Pattern/Decider spans
 *
 * Events are displayed chronologically from top (oldest) to bottom (newest).
 */

import { For, Show, createMemo } from 'solid-js'
import type { TelemetryStore } from '~/lib/otel'
import type { SpanData, SpanStatus } from '~/lib/otel'
import { statusColors, getSpanColor, getSpanLabel } from '~/lib/otel'

interface ObservabilityPanelProps {
  store: TelemetryStore
}

// ============================================================================
// Summary Bar Component
// ============================================================================

const SummaryBar = (props: { store: TelemetryStore }) => {
  const metrics = () => props.store.metrics()

  return (
    <div
      p="3"
      bg="dark-bg-tertiary"
      border="b dark-border-primary"
      flex="~ wrap"
      gap="4"
    >
      <div flex="~" items="center" gap="2">
        <span text="xs dark-text-tertiary">Spans:</span>
        <span text="sm dark-text-primary" font="mono">{metrics().totalCalls}</span>
      </div>

      <div flex="~" items="center" gap="2">
        <span text="xs dark-text-tertiary">Success:</span>
        <span
          text={`sm ${metrics().successRate >= 0.9 ? 'neon-green' : metrics().successRate >= 0.5 ? 'neon-yellow' : 'red-500'}`}
          font="mono"
        >
          {Math.round(metrics().successRate * 100)}%
        </span>
      </div>

      <div flex="~" items="center" gap="2">
        <span text="xs dark-text-tertiary">Avg:</span>
        <span text="sm dark-text-primary" font="mono">{metrics().avgLatency_ms}ms</span>
      </div>

      <Show when={props.store.state.spans.length > 0}>
        <button
          onClick={() => props.store.clearSpans()}
          m="l-auto"
          p="x-2 y-1"
          text="xs red-400"
          bg="red-600/10 hover:red-600/20"
          border="1 red-500/30"
          rounded="md"
          cursor="pointer"
          transition="all"
        >
          Clear
        </button>
      </Show>
    </div>
  )
}

// ============================================================================
// Timeline Event Node Component
// ============================================================================

const EventNode = (props: {
  span: SpanData
  onExpand: (id: string) => void
}) => {
  const hexColor = () => getSpanColor(props.span.name)
  const label = () => getSpanLabel(props.span.name)

  // Map status for display
  const displayStatus = (): SpanStatus => {
    return props.span.status
  }

  return (
    <div
      flex="~ col"
      items="center"
      gap="1"
      p="2 3"
      cursor="pointer"
      bg="transparent hover:dark-bg-hover"
      rounded="md"
      transition="all"
      onClick={() => props.onExpand(props.span.id)}
      w="full"
    >
      {/* Status indicator */}
      <div
        w="3"
        h="3"
        rounded="full"
        bg={statusColors[displayStatus()]}
        shadow="sm"
      />

      {/* Event label */}
      <div
        style={{
          color: hexColor(),
          'font-size': '12px',
          'font-family': '"Fira Code", ui-monospace, monospace',
          'font-weight': '500',
          'text-align': 'center',
          'max-width': '100%',
          overflow: 'hidden',
          'text-overflow': 'ellipsis',
          'white-space': 'nowrap'
        }}
      >
        {label()}
      </div>

      {/* Duration */}
      <Show when={props.span.duration_ms}>
        <div text="xs dark-text-tertiary" font="mono">
          {Math.round(props.span.duration_ms!)}ms
        </div>
      </Show>
    </div>
  )
}

// ============================================================================
// Timeline Row Component
// ============================================================================

const TimelineRow = (props: {
  span: SpanData
  onExpand: (id: string) => void
}) => {
  const isInterface = () => props.span.lane === 'interface'

  return (
    <div
      flex="~"
      min-h="60px"
      border="b dark-border-secondary/30"
    >
      {/* Interface Lane (left) */}
      <div
        w="1/2"
        flex="~"
        justify="center"
        items="center"
        border="r dark-border-secondary/30"
      >
        <Show when={isInterface()}>
          <EventNode span={props.span} onExpand={props.onExpand} />
        </Show>
      </div>

      {/* Tools Lane (right) */}
      <div
        w="1/2"
        flex="~"
        justify="center"
        items="center"
      >
        <Show when={!isInterface()}>
          <EventNode span={props.span} onExpand={props.onExpand} />
        </Show>
      </div>
    </div>
  )
}

// ============================================================================
// Lane Headers Component
// ============================================================================

const LaneHeaders = () => (
  <div
    flex="~"
    border="b dark-border-primary"
    bg="dark-bg-secondary"
    style={{ position: "sticky", top: "0", "z-index": "10" }}
  >
    {/* Interface Lane Header */}
    <div
      w="1/2"
      p="2"
      flex="~"
      items="center"
      justify="center"
      gap="2"
      border="r dark-border-secondary"
    >
      <div w="2" h="2" rounded="full" bg="cyber-500" />
      <span text="xs dark-text-primary" font="medium">Interface</span>
    </div>

    {/* Tools Lane Header */}
    <div
      w="1/2"
      p="2"
      flex="~"
      items="center"
      justify="center"
      gap="2"
    >
      <div w="2" h="2" rounded="full" bg="neon-cyan" />
      <span text="xs dark-text-primary" font="medium">Tools</span>
    </div>
  </div>
)

// ============================================================================
// Empty State Component
// ============================================================================

const EmptyState = () => (
  <div
    flex="~ col"
    items="center"
    justify="center"
    h="full"
    p="8"
    text="center"
  >
    <svg
      width="48"
      height="48"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      style={{ color: '#4f46e5', opacity: 0.4 }}
    >
      <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
    <div text="sm dark-text-secondary" m="t-3">
      No spans yet
    </div>
    <div text="xs dark-text-tertiary" m="t-1">
      Send a message to see the timeline
    </div>
  </div>
)

// ============================================================================
// Span Detail Overlay Component
// ============================================================================

const SpanDetailOverlay = (props: {
  span: SpanData
  onClose: () => void
  onDelete: () => void
}) => {
  return (
    <div
      style={{
        position: "absolute",
        inset: "0",
        "background-color": "rgba(13, 17, 23, 0.95)",
        "backdrop-filter": "blur(4px)",
        "z-index": "50",
        display: "flex",
        "flex-direction": "column",
        overflow: "hidden"
      }}
    >
      {/* Header */}
      <div
        flex="~"
        items="center"
        justify="between"
        p="4"
        border="b dark-border-primary"
      >
        <div flex="~ col" gap="1">
          <span text="sm dark-text-primary" font="medium">
            {props.span.name}
          </span>
          <span text="xs dark-text-tertiary">
            {props.span.duration_ms ? `${Math.round(props.span.duration_ms)}ms` : 'pending'}
          </span>
        </div>
        <div flex="~" gap="2">
          <button
            onClick={props.onDelete}
            p="2"
            text="red-400"
            bg="red-600/10 hover:red-600/20"
            rounded="md"
            cursor="pointer"
          >
            Delete
          </button>
          <button
            onClick={props.onClose}
            p="2"
            text="dark-text-secondary"
            bg="dark-bg-hover hover:dark-bg-tertiary"
            rounded="md"
            cursor="pointer"
          >
            Close
          </button>
        </div>
      </div>

      {/* Content */}
      <div flex="1" overflow="auto" p="4">
        {/* Attributes */}
        <Show when={Object.keys(props.span.attributes).length > 0}>
          <div m="b-4">
            <div text="xs dark-text-tertiary" m="b-2">Attributes</div>
            <pre
              text="xs dark-text-primary"
              bg="dark-bg-tertiary"
              p="3"
              rounded="md"
              overflow="auto"
            >
              {JSON.stringify(props.span.attributes, null, 2)}
            </pre>
          </div>
        </Show>

        {/* Events */}
        <Show when={props.span.events.length > 0}>
          <div>
            <div text="xs dark-text-tertiary" m="b-2">Events</div>
            <For each={props.span.events}>
              {(event) => (
                <div
                  p="2"
                  m="b-2"
                  bg="dark-bg-tertiary"
                  rounded="md"
                >
                  <div text="xs neon-cyan" font="medium">{event.name}</div>
                  <Show when={event.attributes}>
                    <pre text="xs dark-text-secondary" m="t-1">
                      {JSON.stringify(event.attributes, null, 2)}
                    </pre>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  )
}

// ============================================================================
// Main Panel Component
// ============================================================================

export const ObservabilityPanel = (props: ObservabilityPanelProps) => {
  const state = () => props.store.state

  // Sort spans chronologically (oldest first)
  const timelineSpans = createMemo(() => {
    return [...state().spans].sort((a, b) => a.startTime - b.startTime)
  })

  // Get expanded span
  const expandedSpan = createMemo(() => {
    const id = state().expandedSpanId
    if (!id) return null
    return props.store.getSpan(id)
  })

  const handleExpand = (id: string) => props.store.expandSpan(id)
  const handleClose = () => props.store.collapseSpan()
  const handleDelete = (id: string) => {
    props.store.deleteSpan(id)
    props.store.collapseSpan()
  }

  const hasSpans = () => timelineSpans().length > 0

  return (
    <div flex="~ col" h="full" bg="dark-bg-primary" overflow="hidden" position="relative">
      {/* Summary Bar */}
      <SummaryBar store={props.store} />

      {/* Lane Headers */}
      <LaneHeaders />

      {/* Timeline Container */}
      <div flex="1" overflow="auto">
        <Show
          when={hasSpans()}
          fallback={<EmptyState />}
        >
          <For each={timelineSpans()}>
            {(span) => (
              <TimelineRow
                span={span}
                onExpand={handleExpand}
              />
            )}
          </For>
        </Show>
      </div>

      {/* Span Detail Overlay */}
      <Show when={expandedSpan()}>
        <SpanDetailOverlay
          span={expandedSpan()!}
          onClose={handleClose}
          onDelete={() => handleDelete(state().expandedSpanId!)}
        />
      </Show>
    </div>
  )
}
