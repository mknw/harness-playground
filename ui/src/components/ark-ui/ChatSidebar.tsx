import { For } from 'solid-js'

interface ChatThread {
  id: string
  title: string
  timestamp: Date
}

// Dummy data for thread history
const dummyThreads: ChatThread[] = [
  { id: '1', title: 'Knowledge Graph Architecture', timestamp: new Date(Date.now() - 1000 * 60 * 30) },
  { id: '2', title: 'Authentication Flow Discussion', timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2) },
  { id: '3', title: 'UnoCSS Setup Questions', timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24) },
  { id: '4', title: 'Docker Compose Configuration', timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2) },
]

const formatTimestamp = (date: Date): string => {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

interface ChatSidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export const ChatSidebar = (props: ChatSidebarProps) => {
  return (
    <div
      flex="~ col"
      h="full"
      bg="dark-bg-primary"
      border="r dark-border-primary"
      transition="width"
      style={`width: ${props.collapsed ? '3rem' : '16rem'};`}
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
            <div p="2" space="y-1">
              <For each={dummyThreads}>
                {(thread) => (
                  <button
                    w="full"
                    text="left"
                    p="3"
                    rounded="md"
                    hover="bg-dark-bg-hover"
                    transition="all"
                    border="1 transparent hover:neon-cyan/30"
                    cursor="pointer"
                  >
                    <div text="sm dark-text-primary" font="medium" truncate>
                      {thread.title}
                    </div>
                    <div text="xs dark-text-tertiary" m="t-1">
                      {formatTimestamp(thread.timestamp)}
                    </div>
                  </button>
                )}
              </For>
            </div>
          </div>

          {/* New Chat Button */}
          <div p="4" border="t dark-border-primary">
            <button
              w="full"
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
