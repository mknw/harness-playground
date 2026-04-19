/**
 * Data Stash Panel
 *
 * Displays tool_result events partitioned into three sections:
 *   - Current Turn: results from the latest user turn (raw data, no summary yet)
 *   - Previous Turns: results from prior turns (with summaries if available), collapsible
 *   - Archived: hidden/archived results (grayed out), collapsible
 *
 * Each item can be hidden (excluded from LLM context but stays in section, grayed out),
 * archived (moved to Archived section), or restored.
 */

import { For, Show, createSignal, createMemo } from 'solid-js'
import type { ContextEvent, ToolResultEventData } from '~/lib/harness-patterns'

// ============================================================================
// Types
// ============================================================================

export type StashAction = 'hide' | 'unhide' | 'archive' | 'unarchive'

export interface DataStashPanelProps {
  events: ContextEvent[]
  sessionId: string
  onStashAction: (eventId: string, action: StashAction) => Promise<void>
}

interface ToolResultItem {
  event: ContextEvent
  data: ToolResultEventData
}

// ============================================================================
// Helpers
// ============================================================================

/** Find the index of the last user_message event */
function findLastUserMessageIndex(events: ContextEvent[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'user_message') return i
  }
  return -1
}

/** Truncate a string for display */
function truncate(str: string, max: number): string {
  if (str.length <= max) return str
  return str.slice(0, max) + '...'
}

// ============================================================================
// Collapsible Section
// ============================================================================

const CollapsibleSection = (props: {
  title: string
  count: number
  defaultOpen?: boolean
  children: any
}) => {
  const [open, setOpen] = createSignal(props.defaultOpen ?? true)

  return (
    <div border="b dark-border-primary">
      <button
        onClick={() => setOpen(!open())}
        w="full"
        flex="~"
        items="center"
        justify="between"
        p="x-3 y-2"
        bg="dark-bg-secondary hover:dark-bg-tertiary"
        cursor="pointer"
        border="none"
        text="sm dark-text-secondary"
      >
        <span flex="~" items="center" gap="2">
          <span text="xs" style={{ 'font-family': 'monospace' }}>
            {open() ? '▼' : '▶'}
          </span>
          <span font="medium">{props.title}</span>
          <span text="xs dark-text-tertiary" font="mono">({props.count})</span>
        </span>
      </button>
      <Show when={open()}>
        <div>{props.children}</div>
      </Show>
    </div>
  )
}

// ============================================================================
// Tool Result Card
// ============================================================================

const ToolResultCard = (props: {
  item: ToolResultItem
  isGrayed: boolean
  actions: { label: string; action: StashAction }[]
  onAction: (eventId: string, action: StashAction) => Promise<void>
}) => {
  const [loading, setLoading] = createSignal(false)
  const resultStr = () => {
    const r = props.item.data.result
    return typeof r === 'string' ? r : JSON.stringify(r, null, 2)
  }

  const handleAction = async (action: StashAction) => {
    setLoading(true)
    try {
      await props.onAction(props.item.event.id!, action)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      p="3"
      m="x-2 y-1"
      bg="dark-bg-tertiary"
      border="1 dark-border-primary"
      rounded="md"
      opacity={props.isGrayed ? '40' : '100'}
      transition="opacity"
    >
      {/* Header: tool name + success badge */}
      <div flex="~" items="center" justify="between" m="b-2">
        <div flex="~" items="center" gap="2">
          <span text="xs" style={{ opacity: props.isGrayed ? '0.5' : '1' }}>
            {props.item.data.success ? '📥' : '❌'}
          </span>
          <span
            text="sm dark-text-primary"
            font="mono medium"
          >
            {props.item.data.tool}
          </span>
          <Show when={!props.item.data.success}>
            <span text="xs red-400" font="mono">error</span>
          </Show>
        </div>

        {/* Action buttons */}
        <div flex="~" gap="1">
          <For each={props.actions}>
            {(btn) => (
              <button
                onClick={() => handleAction(btn.action)}
                disabled={loading()}
                p="x-2 y-0.5"
                text="xs dark-text-tertiary hover:dark-text-primary"
                bg="transparent hover:dark-bg-secondary"
                border="1 dark-border-primary"
                rounded="sm"
                cursor="pointer"
                transition="all"
              >
                {btn.label}
              </button>
            )}
          </For>
        </div>
      </div>

      {/* Summary (if available) */}
      <Show when={props.item.data.summary}>
        <div
          p="2"
          m="b-2"
          bg="cyan-600/5"
          border="l-2 cyan-500/30"
          rounded="r-sm"
          text="xs dark-text-secondary"
        >
          {props.item.data.summary}
        </div>
      </Show>

      {/* Raw result preview */}
      <div
        p="2"
        bg="dark-bg-primary"
        rounded="sm"
        text="xs dark-text-tertiary"
        font="mono"
        overflow="hidden"
        style={{ 'white-space': 'pre-wrap', 'word-break': 'break-all', 'max-height': '120px' }}
      >
        {truncate(resultStr(), 500)}
      </div>
    </div>
  )
}

// ============================================================================
// Empty State
// ============================================================================

const EmptyState = () => (
  <div
    flex="~ col"
    items="center"
    justify="center"
    p="8"
    text="dark-text-tertiary"
    gap="2"
  >
    <span text="2xl" opacity="50">📦</span>
    <span text="sm">No tool results yet</span>
    <span text="xs dark-text-tertiary">
      Interact with an agent to see data here
    </span>
  </div>
)

// ============================================================================
// Main Component
// ============================================================================

export const DataStashPanel = (props: DataStashPanelProps) => {
  // Partition tool_result events into current turn, previous, and archived
  const partitioned = createMemo(() => {
    const toolResults: ToolResultItem[] = props.events
      .filter(e => e.type === 'tool_result' && e.id)
      .map(e => ({ event: e, data: e.data as ToolResultEventData }))

    const lastUserIdx = findLastUserMessageIndex(props.events)

    const current: ToolResultItem[] = []
    const previous: ToolResultItem[] = []
    const archived: ToolResultItem[] = []

    for (const item of toolResults) {
      if (item.data.archived) {
        archived.push(item)
      } else {
        // Determine if event is from current turn (after last user_message)
        const eventIdx = props.events.indexOf(item.event)
        if (lastUserIdx >= 0 && eventIdx > lastUserIdx) {
          current.push(item)
        } else {
          previous.push(item)
        }
      }
    }

    return { current, previous, archived }
  })

  const totalCount = createMemo(() => {
    const p = partitioned()
    return p.current.length + p.previous.length + p.archived.length
  })

  return (
    <div flex="~ col" h="full" overflow="auto" bg="dark-bg-primary">
      {/* Header */}
      <div
        p="3"
        bg="dark-bg-tertiary"
        border="b dark-border-primary"
        flex="~"
        items="center"
        gap="3"
      >
        <span text="sm dark-text-primary" font="medium">Data Stash</span>
        <span text="xs dark-text-tertiary" font="mono">{totalCount()} results</span>
      </div>

      <Show when={totalCount() === 0}>
        <EmptyState />
      </Show>

      <Show when={totalCount() > 0}>
        {/* Current Turn — always open, no collapsible */}
        <Show when={partitioned().current.length > 0}>
          <div border="b dark-border-primary">
            <div p="x-3 y-2" text="xs dark-text-tertiary" font="medium">
              Current Turn
              <span font="mono" m="l-1">({partitioned().current.length})</span>
            </div>
            <For each={partitioned().current}>
              {(item) => (
                <ToolResultCard
                  item={item}
                  isGrayed={!!item.data.hidden}
                  actions={
                    item.data.hidden
                      ? [{ label: 'Unhide', action: 'unhide' }, { label: 'Archive', action: 'archive' }]
                      : [{ label: 'Hide', action: 'hide' }, { label: 'Archive', action: 'archive' }]
                  }
                  onAction={props.onStashAction}
                />
              )}
            </For>
          </div>
        </Show>

        {/* Previous Turns — collapsible, open by default */}
        <Show when={partitioned().previous.length > 0}>
          <CollapsibleSection
            title="Previous Turns"
            count={partitioned().previous.length}
            defaultOpen={true}
          >
            <For each={partitioned().previous}>
              {(item) => (
                <ToolResultCard
                  item={item}
                  isGrayed={!!item.data.hidden}
                  actions={
                    item.data.hidden
                      ? [{ label: 'Unhide', action: 'unhide' }, { label: 'Archive', action: 'archive' }]
                      : [{ label: 'Hide', action: 'hide' }, { label: 'Archive', action: 'archive' }]
                  }
                  onAction={props.onStashAction}
                />
              )}
            </For>
          </CollapsibleSection>
        </Show>

        {/* Archived — collapsible, collapsed by default */}
        <Show when={partitioned().archived.length > 0}>
          <CollapsibleSection
            title="Archived"
            count={partitioned().archived.length}
            defaultOpen={false}
          >
            <For each={partitioned().archived}>
              {(item) => (
                <ToolResultCard
                  item={item}
                  isGrayed={true}
                  actions={[{ label: 'Unarchive', action: 'unarchive' }]}
                  onAction={props.onStashAction}
                />
              )}
            </For>
          </CollapsibleSection>
        </Show>
      </Show>
    </div>
  )
}
