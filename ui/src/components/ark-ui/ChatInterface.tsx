/**
 * ChatInterface Component
 *
 * Main chat interface that coordinates:
 * - User message input
 * - Agent processing (via API route or inline server function)
 * - Message display with tool calls
 * - Graph visualization updates
 *
 * Architecture:
 * - Uses harness-patterns via server wrapper
 * - Telemetry handled by OpenTelemetry (no store prop)
 * - Generic extractors for graph data
 */

import { createSignal, onMount } from 'solid-js'
import { ChatMessages, type Message } from './ChatMessages'
import { ChatInput } from './ChatInput'
import { ChatSidebar } from './ChatSidebar'
import { AgentOrchestrator } from '~/lib/harness-patterns'
import type { OrchestratorResult } from '~/lib/harness-patterns'
import { extractGraphFromToolEvents } from '~/lib/graph/extractors'
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

  // Server wrapper - "use server" INSIDE the function (SolidJS requirement)
  const processMessageServer = async (message: string): Promise<OrchestratorResult> => {
    "use server"
    const orchestrator = new AgentOrchestrator()
    return orchestrator.processMessage(message)
  }

  const approveOperationServer = async (): Promise<OrchestratorResult> => {
    "use server"
    const orchestrator = new AgentOrchestrator()
    return orchestrator.approveOperation()
  }

  const rejectOperationServer = async (reason?: string): Promise<OrchestratorResult> => {
    "use server"
    const orchestrator = new AgentOrchestrator()
    return orchestrator.rejectOperation(reason)
  }

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
      // Process message via server wrapper
      const result = await processMessageServer(content)

      // Build assistant message
      const assistantMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: result.response,
        timestamp: new Date(),
        // Map pending approval to toolCall for UI display
        toolCall: result.needsApproval && result.pendingPlan ? {
          type: 'neo4j',
          status: 'pending',
          tool: result.pendingPlan.toolName,
          cypher: extractCypherFromPayload(result.pendingPlan.payload),
          explanation: result.pendingPlan.reasoning,
          isReadOnly: false
        } : undefined
      }

      setMessages([...messages(), assistantMessage])

      // Extract and update graph from toolEvents (generic extractor)
      if (result.toolEvents && result.toolEvents.length > 0) {
        const graphElements = extractGraphFromToolEvents(result.toolEvents)
        console.log('[ChatInterface] Extracted graph elements:', graphElements.length)
        if (graphElements.length > 0) {
          props.onGraphUpdate?.(graphElements)
        }
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
      // Execute the approved operation
      const result = await approveOperationServer()

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

      // Extract and update graph
      if (result.toolEvents && result.toolEvents.length > 0) {
        const graphElements = extractGraphFromToolEvents(result.toolEvents)
        if (graphElements.length > 0) {
          props.onGraphUpdate?.(graphElements)
        }
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
      // Reject the pending operation
      const result = await rejectOperationServer()

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

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract cypher query from plan payload
 */
function extractCypherFromPayload(payload: string): string | undefined {
  try {
    const parsed = JSON.parse(payload)
    return parsed.query
  } catch {
    return payload
  }
}
