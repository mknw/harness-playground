/**
 * ChatInterface Component
 *
 * Main chat interface that coordinates:
 * - User message input
 * - Agent processing (via server functions)
 * - Message display with tool calls
 * - Graph visualization updates
 *
 * Architecture:
 * - Creates AgentOrchestrator synchronously (no async init)
 * - Schema is fetched lazily when needed (server-side)
 */

import { createSignal, onMount } from 'solid-js'
import { ChatMessages, type Message } from './ChatMessages'
import { ChatInput } from './ChatInput'
import { ChatSidebar } from './ChatSidebar'
import { AgentOrchestrator } from '~/lib/utcp-baml-agent'
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
  const [messages, setMessages] = createSignal<Message[]>([])
  const [isProcessing, setIsProcessing] = createSignal(false)
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false)

  // Create orchestrator synchronously - NO async initialization needed
  const orchestrator = new AgentOrchestrator()

  onMount(() => {
    // Add welcome message (no async init required)
    const welcomeMessage: Message = {
      id: Date.now().toString(),
      role: 'assistant',
      content: 'Hello! I\'m your knowledge graph assistant. I can help you:\n\n- Query and explore the Neo4j graph\n- Create new nodes and relationships\n- Analyze patterns and connections\n- Visualize graph data\n\nWhat would you like to know?',
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
      // Process message with agent (two-step flow happens server-side)
      const result = await orchestrator.processMessage(content)

      // Convert AgentMessage to Message
      const assistantMessage: Message = {
        id: result.response.id,
        role: result.response.role,
        content: result.response.content,
        timestamp: result.response.timestamp,
        toolCall: result.response.toolCall,
        graphData: result.response.graphData
      }

      setMessages([...messages(), assistantMessage])

      // Update graph visualization if we got graph data
      if (result.graphUpdate) {
        console.log('[ChatInterface] Graph update received:', result.graphUpdate.length, 'elements')
        if (result.graphUpdate.length > 0) {
          console.log('[ChatInterface] First element:', JSON.stringify(result.graphUpdate[0], null, 2))
        }
        props.onGraphUpdate?.(result.graphUpdate)
      } else {
        console.log('[ChatInterface] No graph update in result')
      }
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
      // Execute the write query
      const { graphUpdate, toolCall } = await orchestrator.executeWriteQuery()

      // Update the message with executed tool call
      setMessages(messages().map(msg => {
        if (msg.id === messageId && msg.toolCall) {
          return {
            ...msg,
            toolCall: toolCall || { ...msg.toolCall, status: 'executed' as const }
          }
        }
        return msg
      }))

      // Add success message
      const successMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: `Write operation completed successfully! ${graphUpdate.length} graph elements were affected.`,
        timestamp: new Date()
      }
      setMessages([...messages(), successMessage])

      // Update graph visualization
      if (graphUpdate.length > 0) {
        props.onGraphUpdate?.(graphUpdate)
      }
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
      // Notify orchestrator of rejection
      const rejectionMessage = await orchestrator.rejectPendingWrite()

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
        content: rejectionMessage,
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
