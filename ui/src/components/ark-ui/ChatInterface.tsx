/**
 * ChatInterface Component
 *
 * Main chat interface that coordinates:
 * - User message input
 * - Agent processing via server actions
 * - Message display with tool calls
 * - Graph visualization updates
 * - Agent selection
 * - Context event streaming for observability
 *
 * Architecture:
 * - Uses harness-client server actions
 * - ContextEvents streamed to parent for observability
 * - Session ID per component instance
 */

import { createSignal, createUniqueId, onMount, onCleanup } from 'solid-js'
import { ChatMessages, type Message } from './ChatMessages'
import { ChatInput } from './ChatInput'
import { ChatSidebar } from './ChatSidebar'
import { AgentSelector } from './AgentSelector'
import { approveAction, rejectAction, clearSession, extractGraphFromResult, extractGraphElements } from '~/lib/harness-client'
import type { GraphElement } from './SupportPanel'
import type { ContextEvent, UnifiedContext } from '~/lib/harness-patterns'

// ============================================================================
// Types
// ============================================================================

export interface ChatInterfaceProps {
  onGraphUpdate?: (elements: GraphElement[]) => void
  onEventsUpdate?: (events: ContextEvent[]) => void
  onContextUpdate?: (ctx: UnifiedContext) => void
}

// ============================================================================
// Component
// ============================================================================

export const ChatInterface = (props: ChatInterfaceProps) => {
  const sessionId = createUniqueId()
  const [messages, setMessages] = createSignal<Message[]>([])
  const [isProcessing, setIsProcessing] = createSignal(false)
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false)
  const [selectedAgent, setSelectedAgent] = createSignal('default')
  // Cursor into ctx.events — tracks how many events were sent last turn so we
  // emit only the delta (new events) rather than the full accumulated history
  let prevEventCount = 0

  onCleanup(() => {
    // Clean up session when component unmounts
    clearSession(sessionId)
  })

  onMount(() => {
    // Add welcome message
    const welcomeMessage: Message = {
      id: Date.now().toString(),
      role: 'assistant',
      content: 'Hello! I\'m your knowledge assistant. I can help you:\n\n- Query and explore your Knowledge Base\n- Create new observations\n- Analyze patterns and connections\n- Use additional tools\n\nSelect an agent from the dropdown above, then ask me anything!',
      timestamp: new Date()
    }
    setMessages([welcomeMessage])
  })

  const handleAgentChange = (agentId: string) => {
    // Clear session when agent changes
    clearSession(sessionId)
    prevEventCount = 0
    setSelectedAgent(agentId)

    // Add info message about agent change
    const infoMessage: Message = {
      id: Date.now().toString(),
      role: 'assistant',
      content: `Switched to **${agentId}** agent. Session cleared.`,
      timestamp: new Date()
    }
    setMessages([infoMessage])
  }

  const handleSendMessage = async (content: string) => {
    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content,
      timestamp: new Date()
    }
    setMessages([...messages(), userMessage])
    setIsProcessing(true)

    try {
      // Stream events via SSE endpoint for real-time updates
      const response = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          message: content,
          agentId: selectedAgent()
        })
      })

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response stream')

      const decoder = new TextDecoder()
      let buffer = ''
      let finalResult: { response: string; data: Record<string, unknown>; status: string; context: UnifiedContext } | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // SSE frames are delimited by double newlines
        const frames = buffer.split('\n\n')
        buffer = frames.pop() ?? '' // Keep incomplete frame in buffer

        for (const frame of frames) {
          if (!frame.trim()) continue

          let eventType = 'message'
          let dataStr = ''

          for (const line of frame.split('\n')) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim()
            } else if (line.startsWith('data: ')) {
              dataStr += line.slice(6)
            }
          }

          if (!dataStr) continue

          try {
            const parsed = JSON.parse(dataStr)

            if (eventType === 'done') {
              finalResult = parsed
            } else if (eventType === 'error') {
              throw new Error(parsed.error)
            } else if (parsed.type) {
              // Regular event — stream to UI
              const evt = parsed as ContextEvent
              if (props.onEventsUpdate) {
                props.onEventsUpdate([evt])
              }

              // Reactive graph update on tool_result events
              if (evt.type === 'tool_result' && props.onGraphUpdate) {
                const graphElements = extractGraphElements([evt])
                if (graphElements.length > 0) {
                  props.onGraphUpdate(graphElements)
                }
              }
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue // Skip malformed JSON
            throw e
          }
        }
      }

      // Update event count cursor and emit final context
      if (finalResult?.context) {
        prevEventCount = finalResult.context.events?.length ?? 0
        if (props.onContextUpdate) {
          props.onContextUpdate(finalResult.context as UnifiedContext)
        }
      }

      // Build assistant message from final result
      const assistantMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: finalResult?.response ?? '',
        timestamp: new Date(),
        toolCall: finalResult?.status === 'paused' && (finalResult.data as Record<string, unknown>).pendingAction ? {
          type: 'neo4j',
          status: 'pending',
          tool: ((finalResult.data as Record<string, unknown>).pendingAction as { action: string }).action,
          explanation: ((finalResult.data as Record<string, unknown>).pendingAction as { reason: string }).reason,
          isReadOnly: false
        } : undefined
      }

      setMessages([...messages(), assistantMessage])
    } catch (error) {
      console.error('Error processing message:', error)

      const errorMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: `Sorry, I encountered an error:\n\n\`\`\`\n${error instanceof Error ? error.message : 'Unknown error'}\n\`\`\`\n\nPlease try rephrasing your question.`,
        timestamp: new Date()
      }
      setMessages([...messages(), errorMessage])
    } finally {
      setIsProcessing(false)
    }
  }

  const handleApproveWrite = async (messageId: string) => {
    setIsProcessing(true)

    try {
      // Execute the approved operation
      const result = await approveAction(sessionId)

      // Extract graph elements from result and update visualization
      const graphElements = extractGraphFromResult(result)
      if (graphElements.length > 0 && props.onGraphUpdate) {
        props.onGraphUpdate(graphElements)
      }

      // Emit only new context events (delta since last turn)
      if (result.context?.events && props.onEventsUpdate) {
        const newEvents = result.context.events.slice(prevEventCount)
        prevEventCount = result.context.events.length
        if (newEvents.length > 0) props.onEventsUpdate(newEvents)
      }
      if (result.context && props.onContextUpdate) {
        props.onContextUpdate(result.context)
      }

      // Update the message with executed tool call
      setMessages(messages().map(msg => {
        if (msg.id === messageId && msg.toolCall) {
          return {
            ...msg,
            toolCall: { ...msg.toolCall, status: 'executed' as const }
          }
        }
        return msg
      }))

      // Add success message
      const successMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: result.response,
        timestamp: new Date()
      }
      setMessages([...messages(), successMessage])
    } catch (error) {
      console.error('Error executing write query:', error)

      // Update the message to mark tool call as error
      setMessages(messages().map(msg => {
        if (msg.id === messageId && msg.toolCall) {
          return {
            ...msg,
            toolCall: { ...msg.toolCall, status: 'error' as const, error: String(error) }
          }
        }
        return msg
      }))

      const errorMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: `Write operation failed:\n\n\`\`\`\n${error instanceof Error ? error.message : 'Unknown error'}\n\`\`\``,
        timestamp: new Date()
      }
      setMessages([...messages(), errorMessage])
    } finally {
      setIsProcessing(false)
    }
  }

  const handleRejectWrite = async (messageId: string) => {
    try {
      // Reject the pending operation
      const result = await rejectAction(sessionId)

      // Update the message to show rejection in tool call
      setMessages(messages().map(msg => {
        if (msg.id === messageId && msg.toolCall) {
          return {
            ...msg,
            toolCall: { ...msg.toolCall, status: 'error' as const, error: 'Rejected by user' }
          }
        }
        return msg
      }))

      // Add rejection message from agent
      const responseMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: result.response,
        timestamp: new Date()
      }
      setMessages([...messages(), responseMessage])
    } catch (error) {
      console.error('Error rejecting write:', error)
    }
  }

  return (
    <div flex="~" h="full">
      {/* Sidebar */}
      <ChatSidebar
        collapsed={sidebarCollapsed()}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed())}
      />

      {/* Main Chat Area */}
      <div flex="~ col 1" bg="dark-bg-secondary">
        {/* Agent Selector Header */}
        <div
          flex="~ items-center gap-4"
          border="b dark-border-primary"
          px="4"
          py="2"
          bg="dark-bg-tertiary/50"
        >
          <span text="sm dark-text-secondary">Agent:</span>
          <div w="64">
            <AgentSelector
              selectedAgent={selectedAgent()}
              onAgentChange={handleAgentChange}
              disabled={isProcessing()}
            />
          </div>
        </div>

        {/* Messages */}
        <ChatMessages
          messages={messages()}
          onApproveWrite={handleApproveWrite}
          onRejectWrite={handleRejectWrite}
        />

        {/* Input */}
        <div border="t dark-border-primary" p="4" bg="dark-bg-secondary/80" backdrop-blur="sm">
          <ChatInput onSend={handleSendMessage} disabled={isProcessing()} />
        </div>
      </div>
    </div>
  )
}
