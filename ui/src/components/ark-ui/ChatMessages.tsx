/**
 * ChatMessages Component
 *
 * Renders the chat message history with:
 * - User messages (right-aligned)
 * - Assistant messages (left-aligned)
 * - Tool calls displayed SEPARATELY below messages (via ToolCallDisplay)
 */

import { ScrollArea } from '@ark-ui/solid/scroll-area'
import { For, Show, createEffect, createSignal, createMemo } from 'solid-js'
import type { ElementDefinition } from 'cytoscape'
import type { ToolCallInfo } from '~/lib/utcp-baml-agent/server'
import { ToolCallDisplay } from './ToolCallDisplay'
import { marked } from 'marked'

// Configure marked for safe HTML output
marked.setOptions({
  breaks: true, // Convert \n to <br>
  gfm: true     // GitHub Flavored Markdown
})

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
  toolCall?: ToolCallInfo  // Single tool call (not array)
  graphData?: ElementDefinition[]
}

interface ChatMessagesProps {
  messages: Message[]
  onApproveWrite?: (messageId: string) => void
  onRejectWrite?: (messageId: string) => void
}

export const ChatMessages = (props: ChatMessagesProps) => {
  let bottomRef: HTMLDivElement | undefined
  const [prevCount, setPrevCount] = createSignal(0)

  // Auto-scroll ONLY when new messages are added (not on content updates)
  createEffect(() => {
    const currentCount = props.messages.length

    // Only scroll if message count increased (new message added)
    if (currentCount > prevCount() && bottomRef) {
      setTimeout(() => {
        bottomRef?.scrollIntoView({ behavior: 'smooth', block: 'end' })
      }, 50)
    }

    setPrevCount(currentCount)
  })

  const getInitials = (role: string) => {
    return role === 'user' ? 'U' : 'AI'
  }

  return (
    <ScrollArea.Root style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
      <ScrollArea.Viewport style={{ height: '100%' }}>
        <ScrollArea.Content p="4" space="y-4">
          <For each={props.messages}>
            {(message) => (
              <div flex="~ col" gap="2">
                {/* Message Bubble */}
                <div
                  flex="~"
                  gap="3"
                  data-role={message.role}
                  class={message.role === 'user' ? 'flex-row-reverse' : ''}
                >
                  {/* Avatar */}
                  <div
                    flex="~ shrink-0"
                    w="8"
                    h="8"
                    rounded="full"
                    items="center"
                    justify="center"
                    text="white xs"
                    font="medium"
                    bg={message.role === 'user' ? 'cyber-700' : 'dark-bg-tertiary'}
                    border={message.role === 'user' ? '1 cyber-500' : '1 neon-cyan/50'}
                    shadow={message.role === 'user' ? '[0_0_10px_rgba(79,70,229,0.3)]' : '[0_0_10px_rgba(0,255,255,0.2)]'}
                  >
                    {getInitials(message.role)}
                  </div>

                  {/* Message Content */}
                  <div
                    max-w="2xl"
                    p="3"
                    rounded="lg"
                    bg={message.role === 'user' ? 'cyber-800/50' : 'dark-bg-tertiary'}
                    text="dark-text-primary"
                    border={message.role === 'user' ? '1 cyber-700/50' : '1 dark-border-secondary'}
                    backdrop-blur="sm"
                  >
                    <Show
                      when={message.role === 'assistant'}
                      fallback={
                        <div text="sm" white-space="pre-wrap" break-words>
                          {message.content}
                        </div>
                      }
                    >
                      <div
                        text="sm"
                        class="prose-chat"
                        innerHTML={marked.parse(message.content) as string}
                      />
                    </Show>

                    <div text="xs dark-text-tertiary" m="t-1">
                      {message.timestamp.toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </div>
                  </div>
                </div>

                {/* Tool Call - SEPARATE from message bubble */}
                <Show when={message.toolCall && message.role === 'assistant'}>
                  <div m="l-11">
                    <ToolCallDisplay
                      toolCall={message.toolCall!}
                      onApprove={() => props.onApproveWrite?.(message.id)}
                      onReject={() => props.onRejectWrite?.(message.id)}
                    />
                  </div>
                </Show>
              </div>
            )}
          </For>

          {/* Empty State */}
          <Show when={props.messages.length === 0}>
            <div
              flex="~"
              items="center"
              justify="center"
              h="full"
              min-h="64"
              text="center"
            >
              <div>
                <div text="2xl neon-cyan/50" m="b-2">
                  <svg
                    width="64"
                    height="64"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    style={{ margin: '0 auto' }}
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                    />
                  </svg>
                </div>
                <div text="lg dark-text-secondary" font="medium">
                  Start a conversation
                </div>
                <div text="sm dark-text-tertiary" m="t-1">
                  Type a message below to begin
                </div>
              </div>
            </div>
          </Show>

          {/* Sentinel element for auto-scroll */}
          <div ref={bottomRef} />
        </ScrollArea.Content>
      </ScrollArea.Viewport>

      <ScrollArea.Scrollbar orientation="vertical" w="2" bg="dark-bg-tertiary">
        <ScrollArea.Thumb bg="cyber-700/50 hover:cyber-600/70" rounded="full" transition="colors" />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  )
}
