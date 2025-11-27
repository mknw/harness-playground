import { createSignal, onMount } from 'solid-js'
import { ChatMessages, type Message, type ToolCall } from './ChatMessages'
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
  const [_initError, setInitError] = createSignal<string | null>(null)

  // Initialize agent orchestrator
  let orchestrator: AgentOrchestrator | null = null

  onMount(async () => {
    try {
      orchestrator = new AgentOrchestrator()
      await orchestrator.initialize()

      // Add welcome message
      const welcomeMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: '👋 Hello! I\'m your knowledge graph assistant. I can help you:\n\n- Query and explore the Neo4j graph\n- Create new nodes and relationships\n- Analyze patterns and connections\n- Visualize graph data\n\nWhat would you like to know?',
        timestamp: new Date()
      }
      setMessages([welcomeMessage])
    } catch (error) {
      console.error('Failed to initialize agent:', error)
      setInitError(error instanceof Error ? error.message : 'Unknown error')

      const errorMessage: Message = {
        id: Date.now().toString(),
        role: 'system',
        content: `⚠️ Failed to initialize agent: ${error instanceof Error ? error.message : 'Unknown error'}\n\nPlease check that:\n- Neo4j is running\n- MCP Gateway is accessible\n- Environment variables are configured`,
        timestamp: new Date()
      }
      setMessages([errorMessage])
    }
  })

  const handleSendMessage = async (content: string) => {
    if (!orchestrator) {
      console.error('Agent not initialized')
      return
    }

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
      // Process message with agent
      const result = await orchestrator.processMessage(content)

      // Convert AgentMessage to Message
      const assistantMessage: Message = {
        id: result.response.id,
        role: result.response.role,
        content: result.response.content,
        timestamp: result.response.timestamp,
        toolCalls: result.response.toolCalls,
        graphData: result.response.graphData
      }

      setMessages([...messages(), assistantMessage])

      // Update graph visualization if we got graph data
      if (result.graphUpdate) {
        props.onGraphUpdate?.(result.graphUpdate)
      }
    } catch (error) {
      console.error('Error processing message:', error)

      const errorMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: `❌ Sorry, I encountered an error:\n\n\`\`\`\n${error instanceof Error ? error.message : 'Unknown error'}\n\`\`\`\n\nPlease try rephrasing your question or check the system logs.`,
        timestamp: new Date()
      }
      setMessages([...messages(), errorMessage])
    } finally {
      setIsProcessing(false)
    }
  }

  const handleApproveWrite = async (messageId: string, toolCall: ToolCall) => {
    if (!orchestrator) {
      console.error('Agent not initialized')
      return
    }

    setIsProcessing(true)

    try {
      // Execute the write query
      const graphUpdate = await orchestrator.executeWriteQuery(
        toolCall.parameters.query as string | undefined
      )

      // Update the message to mark tool call as executed
      setMessages(messages().map(msg => {
        if (msg.id === messageId) {
          return {
            ...msg,
            toolCalls: msg.toolCalls?.map(tc =>
              tc === toolCall ? { ...tc, status: 'executed' as const, result: graphUpdate } : tc
            )
          }
        }
        return msg
      }))

      // Add success message
      const successMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: `✅ Write operation completed successfully!\n\n${graphUpdate.length} graph elements were affected.`,
        timestamp: new Date()
      }
      setMessages([...messages(), successMessage])

      // Update graph visualization
      if (graphUpdate.length > 0) {
        props.onGraphUpdate?.(graphUpdate)
      }
    } catch (error) {
      console.error('Error executing write query:', error)

      // Update the message to mark tool call as rejected
      setMessages(messages().map(msg => {
        if (msg.id === messageId) {
          return {
            ...msg,
            toolCalls: msg.toolCalls?.map(tc =>
              tc === toolCall ? { ...tc, status: 'rejected' as const } : tc
            )
          }
        }
        return msg
      }))

      const errorMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: `❌ Write operation failed:\n\n\`\`\`\n${error instanceof Error ? error.message : 'Unknown error'}\n\`\`\``,
        timestamp: new Date()
      }
      setMessages([...messages(), errorMessage])
    } finally {
      setIsProcessing(false)
    }
  }

  const handleRejectWrite = (messageId: string, toolCall: ToolCall) => {
    // Update the message to mark tool call as rejected
    setMessages(messages().map(msg => {
      if (msg.id === messageId) {
        return {
          ...msg,
          toolCalls: msg.toolCalls?.map(tc =>
            tc === toolCall ? { ...tc, status: 'rejected' as const } : tc
          )
        }
      }
      return msg
    }))

    // Add rejection message
    const rejectionMessage: Message = {
      id: Date.now().toString(),
      role: 'assistant',
      content: '❌ Write operation was rejected by user.',
      timestamp: new Date()
    }
    setMessages([...messages(), rejectionMessage])
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
