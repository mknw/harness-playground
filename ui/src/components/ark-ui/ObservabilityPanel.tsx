/**
 * ObservabilityPanel Component
 *
 * Vertical timeline display with two lanes:
 * - Interface Lane: BAML function telemetry
 * - Tools Lane: Tool execution telemetry with namespace color coding
 *
 * Events are displayed chronologically from top (oldest) to bottom (newest).
 */

import { For, Show, createMemo } from 'solid-js';
import type { TelemetryStore } from '~/lib/baml-agent/telemetry-store';
import type { TimelineEvent } from '~/lib/baml-agent/telemetry';
import {
  getEventLabel,
  getEventDuration,
  getEventHexColor,
  statusColors,
  isInterfaceFunction
} from '~/lib/baml-agent/telemetry';
import { EventDetailOverlay } from './EventDetailOverlay';

interface ObservabilityPanelProps {
  store: TelemetryStore;
}

// ============================================================================
// Summary Bar Component
// ============================================================================

const SummaryBar = (props: { store: TelemetryStore }) => {
  const metrics = () => props.store.metrics();

  return (
    <div
      p="3"
      bg="dark-bg-tertiary"
      border="b dark-border-primary"
      flex="~ wrap"
      gap="4"
    >
      <div flex="~" items="center" gap="2">
        <span text="xs dark-text-tertiary">Calls:</span>
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

      <div flex="~" items="center" gap="2">
        <span text="xs dark-text-tertiary">Tokens:</span>
        <span text="sm neon-cyan" font="mono">
          {metrics().totalTokens.input + metrics().totalTokens.output}
        </span>
      </div>

      <Show when={props.store.state.bamlCalls.length > 0 || props.store.state.toolCalls.length > 0}>
        <button
          onClick={() => props.store.clearTelemetry()}
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
  );
};

// ============================================================================
// Timeline Event Node Component
// ============================================================================

const EventNode = (props: {
  event: TimelineEvent;
  onExpand: (id: string) => void;
}) => {
  const duration = () => getEventDuration(props.event);
  const hexColor = () => getEventHexColor(props.event);

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
      onClick={() => props.onExpand(props.event.id)}
      w="full"
    >
      {/* Status indicator with glow */}
      <div
        w="3"
        h="3"
        rounded="full"
        bg={statusColors[props.event.status]}
        shadow="sm"
      />

      {/* Event label - using inline style for dynamic color */}
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
        {getEventLabel(props.event)}
      </div>

      {/* Duration */}
      <Show when={duration()}>
        <div text="xs dark-text-tertiary" font="mono">
          {duration()}ms
        </div>
      </Show>
    </div>
  );
};

// ============================================================================
// Timeline Row Component
// ============================================================================

const TimelineRow = (props: {
  event: TimelineEvent;
  onExpand: (id: string) => void;
}) => {
  const isInterface = () => props.event.lane === 'interface';

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
          <EventNode event={props.event} onExpand={props.onExpand} />
        </Show>
        {/* Empty cell when event is in other lane - clean, no connector */}
      </div>

      {/* Tools Lane (right) */}
      <div
        w="1/2"
        flex="~"
        justify="center"
        items="center"
      >
        <Show when={!isInterface()}>
          <EventNode event={props.event} onExpand={props.onExpand} />
        </Show>
        {/* Empty cell when event is in other lane - clean, no connector */}
      </div>
    </div>
  );
};

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
);

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
      No events yet
    </div>
    <div text="xs dark-text-tertiary" m="t-1">
      Send a message to see the timeline
    </div>
  </div>
);

// ============================================================================
// Main Panel Component
// ============================================================================

export const ObservabilityPanel = (props: ObservabilityPanelProps) => {
  const { state, expandEvent, collapseEvent, deleteEvent, getEvent } = props.store;

  // Merge and sort ALL events chronologically (oldest first)
  // Interface lane: RouteUserMessage, CreateToolResponse
  // Tools lane: Plan* operations + all tool calls
  const timelineEvents = createMemo(() => {
    const all: TimelineEvent[] = [
      ...state.bamlCalls.map(c => ({
        ...c,
        lane: isInterfaceFunction(c.functionName) ? 'interface' as const : 'tools' as const
      })),
      ...state.toolCalls.map(c => ({ ...c, lane: 'tools' as const }))
    ];
    return all.sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  });

  // Get expanded event
  const expandedEvent = createMemo(() => {
    if (!state.expandedEventId) return null;
    return getEvent(state.expandedEventId);
  });

  const handleDelete = (id: string) => {
    deleteEvent(id);
    collapseEvent();
  };

  const hasEvents = () => timelineEvents().length > 0;

  return (
    <div flex="~ col" h="full" bg="dark-bg-primary" overflow="hidden">
      {/* Summary Bar */}
      <SummaryBar store={props.store} />

      {/* Lane Headers */}
      <LaneHeaders />

      {/* Timeline Container */}
      <div flex="1" overflow="auto">
        <Show
          when={hasEvents()}
          fallback={<EmptyState />}
        >
          <For each={timelineEvents()}>
            {(event) => (
              <TimelineRow
                event={event}
                onExpand={expandEvent}
              />
            )}
          </For>
        </Show>
      </div>

      {/* Event Detail Overlay */}
      <Show when={expandedEvent()}>
        <EventDetailOverlay
          event={expandedEvent()!}
          onClose={collapseEvent}
          onDelete={() => handleDelete(state.expandedEventId!)}
        />
      </Show>
    </div>
  );
};
