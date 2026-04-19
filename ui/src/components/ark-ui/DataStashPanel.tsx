/**
 * Data Stash Panel
 *
 * Displays tool_result events as an icon gallery partitioned into:
 *   - Current Turn: results from the latest user turn
 *   - Previous Turns: results from prior turns (collapsible, open by default)
 *   - Archived: hidden/archived results (collapsible, closed by default)
 *
 * Each icon reflects the tool that produced the result.
 * The label shows a short reference: <tool-prefix>:<short-id>.
 * Hovering shows the LLM summary (or a raw preview if no summary yet).
 */

import { For, Show, createSignal, createMemo } from 'solid-js'
import { Tooltip } from '@ark-ui/solid/tooltip'
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
// Tool → Icon mapping (MDI icons via @iconify-json/mdi + @unocss/preset-icons)
// Usage: class="i-mdi-<icon-name>" renders as CSS background-mask icon
// ============================================================================

function getToolIcon(tool: string): string {
  const t = tool.toLowerCase()
  if (t.includes('neo4j') || t.includes('cypher') || t.includes('graph')) return 'i-mdi-graph-outline'
  if (t.includes('search') || t.includes('web') || t.includes('browse') || t.includes('fetch')) return 'i-mdi-web'
  if (t.includes('redis') || t.includes('cache')) return 'i-mdi-lightning-bolt-outline'
  if (t.includes('memory') || t.includes('brain')) return 'i-mdi-brain'
  if (t.includes('github') || t.includes('git')) return 'i-mdi-github'
  if (t.includes('file') || t.includes('filesystem') || t.includes('read') || t.includes('write')) return 'i-mdi-file-document-outline'
  if (t.includes('context7') || t.includes('doc') || t.includes('library')) return 'i-mdi-book-open-variant'
  if (t.includes('code') || t.includes('script') || t.includes('eval')) return 'i-mdi-code-braces'
  if (t.includes('database') || t.includes('sql')) return 'i-mdi-database-outline'
  return 'i-mdi-package-variant'
}

/** Icon tint color — matches the pattern-color scheme loosely */
function getToolColor(tool: string): string {
  const t = tool.toLowerCase()
  if (t.includes('neo4j') || t.includes('cypher') || t.includes('graph')) return '#22d3ee'  // cyan
  if (t.includes('search') || t.includes('web') || t.includes('browse')) return '#60a5fa'    // blue
  if (t.includes('redis') || t.includes('cache')) return '#f59e0b'                            // amber
  if (t.includes('memory') || t.includes('brain')) return '#a78bfa'                          // violet
  if (t.includes('github') || t.includes('git')) return '#94a3b8'                            // slate
  if (t.includes('file') || t.includes('filesystem')) return '#34d399'                       // emerald
  if (t.includes('code') || t.includes('script')) return '#f472b6'                           // pink
  return '#71717a'                                                                            // zinc default
}

/**
 * Short display label: <tool-prefix>:<last-6-of-id>
 * e.g. "read_neo4j_cypher" + "ev-fr1y8p" → "neo4j:fr1y8p"
 */
function getRefLabel(tool: string, eventId: string): string {
  const shortId = eventId.replace('ev-', '')
  // Extract the most informative segment from the tool name
  const parts = tool.split('_').filter(p => p.length > 2)
  // Prefer domain keywords over generic verbs
  const skip = new Set(['read', 'write', 'get', 'set', 'list', 'create', 'delete', 'fetch', 'run', 'execute'])
  const key = parts.find(p => !skip.has(p)) ?? parts[0] ?? tool
  return `${key}:${shortId}`
}

// ============================================================================
// Helpers
// ============================================================================

function findLastUserMessageIndex(events: ContextEvent[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'user_message') return i
  }
  return -1
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str
  return str.slice(0, max) + '…'
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
        p="x-3 y-2"
        bg="dark-bg-secondary hover:dark-bg-tertiary"
        cursor="pointer"
        border="none"
        text="sm dark-text-secondary"
        gap="2"
      >
        <span text="xs" style={{ 'font-family': 'monospace' }}>
          {open() ? '▼' : '▶'}
        </span>
        <span font="medium">{props.title}</span>
        <span text="xs dark-text-tertiary" font="mono">({props.count})</span>
      </button>
      <Show when={open()}>
        <div>{props.children}</div>
      </Show>
    </div>
  )
}

// ============================================================================
// Icon Chip — single tool result as an icon with tooltip and context menu
// ============================================================================

const StashIcon = (props: {
  item: ToolResultItem
  isGrayed: boolean
  onAction: (eventId: string, action: StashAction) => Promise<void>
}) => {
  const d = () => props.item.data
  const icon = () => getToolIcon(d().tool)
  const color = () => getToolColor(d().tool)
  const label = () => getRefLabel(d().tool, props.item.event.id!)
  const [loading, setLoading] = createSignal(false)
  const [menuOpen, setMenuOpen] = createSignal(false)

  const tooltipText = () => {
    const data = d()
    if (data.summary) return data.summary
    const raw = typeof data.result === 'string' ? data.result : JSON.stringify(data.result)
    return truncate(raw, 300)
  }

  const handleAction = async (action: StashAction) => {
    setMenuOpen(false)
    setLoading(true)
    try { await props.onAction(props.item.event.id!, action) }
    finally { setLoading(false) }
  }

  const menuActions = () => {
    if (d().archived) return [{ label: 'Unarchive', action: 'unarchive' as StashAction }]
    if (d().hidden) return [
      { label: 'Unhide', action: 'unhide' as StashAction },
      { label: 'Archive', action: 'archive' as StashAction },
    ]
    return [
      { label: 'Hide', action: 'hide' as StashAction },
      { label: 'Archive', action: 'archive' as StashAction },
    ]
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <Tooltip.Root openDelay={200} closeDelay={100} positioning={{ placement: 'top' }}>
        <Tooltip.Trigger as="div">
          {/* Icon chip */}
          <div
            flex="~ col"
            items="center"
            gap="1"
            p="2"
            w="16"
            cursor="pointer"
            rounded="lg"
            bg={menuOpen() ? 'dark-bg-tertiary' : 'transparent hover:dark-bg-secondary'}
            border={menuOpen() ? '1 dark-border-secondary' : '1 transparent hover:dark-border-primary'}
            transition="all"
            opacity={props.isGrayed ? '35' : loading() ? '50' : '100'}
            onClick={() => setMenuOpen(!menuOpen())}
          >
            {/* MDI icon rendered via UnoCSS preset-icons */}
            <span
              class={icon()}
              style={{
                width: '28px',
                height: '28px',
                color: props.isGrayed ? '#52525b' : color(),
                filter: props.isGrayed ? 'grayscale(1)' : 'none',
                transition: 'all 0.15s',
              }}
            />
            {/* Reference label */}
            <span
              style={{
                'font-family': '"Fira Code", ui-monospace, monospace',
                'font-size': '9px',
                'color': props.isGrayed ? '#52525b' : '#71717a',
                'text-align': 'center',
                'word-break': 'break-all',
                'line-height': '1.2',
                'max-width': '60px',
              }}
            >
              {label()}
            </span>
            {/* Success/error dot */}
            <Show when={!d().success}>
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  'border-radius': '50%',
                  background: '#ef4444',
                }}
              />
            </Show>
          </div>
        </Tooltip.Trigger>

        <Tooltip.Positioner>
          <Tooltip.Content
            bg="dark-bg-tertiary"
            border="1 dark-border-secondary"
            rounded="md"
            p="3"
            shadow="lg"
            style={{ 'max-width': '280px', 'z-index': '50' }}
          >
            {/* Tool name + ref */}
            <div text="xs dark-text-secondary" font="mono" m="b-2">
              {d().tool} · {props.item.event.id}
            </div>
            {/* Summary or raw preview */}
            <div
              text="xs dark-text-primary"
              style={{ 'line-height': '1.5', 'white-space': 'pre-wrap', 'word-break': 'break-word' }}
            >
              {tooltipText()}
            </div>
            <Show when={!d().summary}>
              <div text="xs dark-text-tertiary" m="t-2" style={{ 'font-style': 'italic' }}>
                Summary pending…
              </div>
            </Show>
          </Tooltip.Content>
        </Tooltip.Positioner>
      </Tooltip.Root>

      {/* Context menu (open on click) */}
      <Show when={menuOpen()}>
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            'z-index': '100',
            background: '#1a1a24',
            border: '1px solid #2a2a3a',
            'border-radius': '6px',
            padding: '4px',
            'min-width': '100px',
            'box-shadow': '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          <For each={menuActions()}>
            {(btn) => (
              <button
                onClick={() => handleAction(btn.action)}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '5px 10px',
                  'text-align': 'left',
                  background: 'transparent',
                  border: 'none',
                  'border-radius': '4px',
                  'font-size': '11px',
                  color: '#a1a1aa',
                  cursor: 'pointer',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#22222f')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {btn.label}
              </button>
            )}
          </For>
          <div style={{ height: '1px', background: '#2a2a3a', margin: '2px 0' }} />
          <button
            onClick={() => setMenuOpen(false)}
            style={{
              display: 'block',
              width: '100%',
              padding: '5px 10px',
              'text-align': 'left',
              background: 'transparent',
              border: 'none',
              'border-radius': '4px',
              'font-size': '11px',
              color: '#52525b',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </Show>

      {/* Click-away backdrop to close menu */}
      <Show when={menuOpen()}>
        <div
          style={{ position: 'fixed', inset: '0', 'z-index': '99' }}
          onClick={() => setMenuOpen(false)}
        />
      </Show>
    </div>
  )
}

// ============================================================================
// Icon Gallery Section
// ============================================================================

const IconGallery = (props: { items: ToolResultItem[]; onAction: (id: string, action: StashAction) => Promise<void> }) => (
  <div
    flex="~ wrap"
    gap="2"
    p="3"
  >
    <For each={props.items}>
      {(item) => (
        <StashIcon
          item={item}
          isGrayed={!!(item.data.hidden || item.data.archived)}
          onAction={props.onAction}
        />
      )}
    </For>
  </div>
)

// ============================================================================
// Main Component
// ============================================================================

export const DataStashPanel = (props: DataStashPanelProps) => {
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
        p="x-3 y-2"
        bg="dark-bg-tertiary"
        border="b dark-border-primary"
        flex="~"
        items="center"
        gap="3"
      >
        <span
          class="i-mdi-package-variant-closed"
          style={{ width: '16px', height: '16px', color: '#71717a' }}
        />
        <span text="sm dark-text-primary" font="medium">Data Stash</span>
        <span text="xs dark-text-tertiary" font="mono">{totalCount()} items</span>
      </div>

      <Show when={totalCount() === 0}>
        <div flex="~ col" items="center" justify="center" p="8" text="dark-text-tertiary" gap="2">
          <span
            class="i-mdi-package-variant-closed-remove"
            style={{ width: '36px', height: '36px', color: '#3f3f46', opacity: '0.6' }}
          />
          <span text="sm m-t-2">No tool results yet</span>
          <span text="xs dark-text-tertiary">Run an agent to see data here</span>
        </div>
      </Show>

      <Show when={totalCount() > 0}>
        {/* Current Turn */}
        <Show when={partitioned().current.length > 0}>
          <div border="b dark-border-primary">
            <div p="x-3 y-2" flex="~" items="center" gap="2">
              <span text="xs dark-text-tertiary" font="medium">Current Turn</span>
              <span text="xs dark-text-tertiary" font="mono">({partitioned().current.length})</span>
            </div>
            <IconGallery items={partitioned().current} onAction={props.onStashAction} />
          </div>
        </Show>

        {/* Previous Turns */}
        <Show when={partitioned().previous.length > 0}>
          <CollapsibleSection
            title="Previous Turns"
            count={partitioned().previous.length}
            defaultOpen={true}
          >
            <IconGallery items={partitioned().previous} onAction={props.onStashAction} />
          </CollapsibleSection>
        </Show>

        {/* Archived */}
        <Show when={partitioned().archived.length > 0}>
          <CollapsibleSection
            title="Archived"
            count={partitioned().archived.length}
            defaultOpen={false}
          >
            <IconGallery items={partitioned().archived} onAction={props.onStashAction} />
          </CollapsibleSection>
        </Show>
      </Show>
    </div>
  )
}
