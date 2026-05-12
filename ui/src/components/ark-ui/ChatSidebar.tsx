import { For, Show } from 'solid-js'
import { SettingsPanel } from './SettingsPanel'

export interface ChatThreadSummary {
  id: string
  title: string | null
  /** ISO 8601 timestamp from the server. */
  updatedAt: string
  /** Optimistic client-side row for a brand-new chat that hasn't been
   *  persisted yet. Replaced in place once the real row appears in the
   *  threadsResource refetch. */
  isPlaceholder?: boolean
}

const PLACEHOLDER_TITLE = 'new chat'

/**
 * Merge the optimistic "+ New Chat" placeholder with the persisted thread
 * list. When the persisted list already contains a row with the placeholder's
 * id (the conversation has been saved), the placeholder is dropped — the real
 * row takes over with its sticky title and timestamp. See #44.
 *
 * Pure: no Solid signals, no DOM — straightforward to unit test.
 */
export function mergeThreadsWithPlaceholder(
  threads: ChatThreadSummary[],
  placeholderId: string | null,
  /** Defaults to `Date.now()` — overrideable for deterministic tests. */
  nowIso: () => string = () => new Date().toISOString(),
): ChatThreadSummary[] {
  if (!placeholderId) return threads
  if (threads.some(t => t.id === placeholderId)) return threads
  const placeholder: ChatThreadSummary = {
    id: placeholderId,
    title: null,
    updatedAt: nowIso(),
    isPlaceholder: true,
  }
  return [placeholder, ...threads]
}

const formatTimestamp = (iso: string): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

interface ChatSidebarProps {
  collapsed: boolean
  onToggle: () => void
  threads: ChatThreadSummary[]
  selectedId: string | null
  onSelectThread: (threadId: string) => void
  onNewChat: () => void
}

export const ChatSidebar = (props: ChatSidebarProps) => {
  return (
    <div
      flex="~ col"
      h="full"
      bg="dark-bg-primary"
      border="r dark-border-primary"
      transition="width"
      style={{width: props.collapsed ? '3rem' : '16rem'}}
    >
      {/* Header with Toggle */}
      <div p="4" border="b dark-border-primary" flex="~" items="center" justify="between">
        {!props.collapsed && (
          <span text="sm dark-text-primary" font="medium">Chat History</span>
        )}
        <button
          onClick={() => props.onToggle()}
          p="2"
          rounded="md"
          hover="bg-dark-bg-hover"
          transition="colors"
          text="neon-cyan"
          flex="shrink-0"
          title={props.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d={props.collapsed ? "M9 5l7 7-7 7" : "M15 19l-7-7 7-7"}
            />
          </svg>
        </button>
      </div>

      {/* Thread List */}
      {!props.collapsed && (
        <>
          <div flex="1" overflow="auto">
            <Show
              when={props.threads.length > 0}
              fallback={
                <div p="4" text="xs dark-text-tertiary">
                  No conversations yet. Send a message to start.
                </div>
              }
            >
              <div p="2" space="y-1">
                <For each={props.threads}>
                  {(thread) => {
                    const isSelected = () => thread.id === props.selectedId
                    return (
                      <button
                        onClick={() => props.onSelectThread(thread.id)}
                        w="full"
                        text="left"
                        p="3"
                        rounded="md"
                        bg={isSelected() ? 'cyber-700/30' : ''}
                        hover="bg-dark-bg-hover"
                        transition="all"
                        border={isSelected() ? '1 neon-cyan/40' : '1 transparent hover:neon-cyan/30'}
                        cursor="pointer"
                        data-placeholder={thread.isPlaceholder ? '' : undefined}
                      >
                        <div
                          text={thread.isPlaceholder ? 'sm dark-text-tertiary' : 'sm dark-text-primary'}
                          font={thread.isPlaceholder ? 'normal italic' : 'medium'}
                          truncate
                        >
                          {thread.isPlaceholder
                            ? PLACEHOLDER_TITLE
                            : thread.title ?? '(untitled)'}
                        </div>
                        <div text="xs dark-text-tertiary" m="t-1">
                          {formatTimestamp(thread.updatedAt)}
                        </div>
                      </button>
                    )
                  }}
                </For>
              </div>
            </Show>
          </div>

          {/* Footer: Settings + New Chat */}
          <div p="4" border="t dark-border-primary" flex="~" gap="2" items="center">
            <SettingsPanel />
            <button
              onClick={() => props.onNewChat()}
              flex="1"
              p="2"
              bg="cyber-700 hover:cyber-600"
              text="white sm"
              font="medium"
              rounded="md"
              transition="all"
              shadow="hover:[0_0_15px_rgba(79,70,229,0.5)]"
            >
              + New Chat
            </button>
          </div>
        </>
      )}
    </div>
  )
}
