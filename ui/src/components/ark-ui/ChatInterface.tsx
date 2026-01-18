/**
 * ChatInterface Component
 *
 * Main chat interface that coordinates:
 * - User message input
 * - Agent processing via server actions
 * - Message display with tool calls
 * - Graph visualization updates
 *
 * Architecture:
 * - Uses harness-client server actions
 * - Telemetry handled by OpenTelemetry
 * - Session ID per component instance
 */

import { createSignal, createUniqueId, onMount, onCleanup } from 'solid-js'
import { ChatMessages, type Message } from './ChatMessages'
import { ChatInput } from './ChatInput'
import { ChatSidebar } from './ChatSidebar'
import { processMessage, approveAction, rejectAction, clearSession } from '~/lib/harness-client'
import type { ElementDefinition } from 'cytoscape'

// ============================================================================
// Types
// ============================================================================

export interface ChatInterfaceProps {
  onGraphUpdate?: (elements: ElementDefinition[]) => void
}

// ============================================================================
// Component
// ============================================================================

export const ChatInterface = (props: ChatInterfaceProps) => {
  const sessionId = createUniqueId()
  const [messages, setMessages] = createSignal<Message[]>([])
  const [isProcessing, setIsProcessing] = createSignal(false)
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false)

  onCleanup(() => {
    // Clean up session when component unmounts
    clearSession(sessionId)
  })

  onMount(() => {
    // Add welcome message
    const welcomeMessage: Message = {
      id: Date.now().toString(),
      role: 'assistant',
      content: 'Hello! I\'m your knowledge assistant. I can help you:\n\n- Query and explore your Knowledge Base\n- Create new observations\n- Analyze patterns and connections\n- Use additional tools\n\nWhat would you like to know?',
      timestamp: new Date()
    }
    setMessages([welcomeMessage])
  })

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
      // Process message via server action
      const result = await processMessage(sessionId, content)

      // Build assistant message
      const assistantMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: result.response,
        timestamp: new Date(),
        // Map pending approval to toolCall for UI display
        toolCall: result.status === 'paused' && result.data.pendingAction ? {
          type: 'neo4j',
          status: 'pending',
          tool: result.data.pendingAction.action,
          explanation: result.data.pendingAction.reason,
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
