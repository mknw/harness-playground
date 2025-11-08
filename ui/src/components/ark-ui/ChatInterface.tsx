import { createSignal } from 'solid-js'
import { ChatMessages, type Message } from './ChatMessages'
import { ChatInput } from './ChatInput'
import { ChatSidebar } from './ChatSidebar'

// Dummy initial messages for demonstration
const initialMessages: Message[] = [
  {
    id: '1',
    role: 'assistant',
    content: 'Hello! I\'m your AI assistant. How can I help you with your knowledge graph today?',
    timestamp: new Date(Date.now() - 1000 * 60 * 5)
  },
  {
    id: '2',
    role: 'user',
    content: 'Can you explain how the authentication system works?',
    timestamp: new Date(Date.now() - 1000 * 60 * 4)
  },
  {
    id: '3',
    role: 'assistant',
    content: 'The authentication system uses Stack Auth with a client-server architecture. On the client side, we use StackClientApp for browser-based operations, while the server uses getCurrentUser() via Stack Auth cookies. Additionally, there\'s an email allowlist system that controls access.',
    timestamp: new Date(Date.now() - 1000 * 60 * 3)
  }
]

export const ChatInterface = () => {
  const [messages, setMessages] = createSignal<Message[]>(initialMessages)
  const [isProcessing, setIsProcessing] = createSignal(false)
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false)

  const handleSendMessage = async (content: string) => {
    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content,
      timestamp: new Date()
    }
    setMessages([...messages(), userMessage])

    // Simulate AI response
    setIsProcessing(true)

    // Simulate processing delay
    setTimeout(() => {
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `I received your message: "${content}". This is a placeholder response. The actual AI integration will be implemented later.`,
        timestamp: new Date()
      }
      setMessages([...messages(), aiMessage])
      setIsProcessing(false)
    }, 1000)
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
        <ChatMessages messages={messages()} />

        {/* Input */}
        <div border="t dark-border-primary" p="4" bg="dark-bg-secondary/80" backdrop-blur="sm">
          <ChatInput onSend={handleSendMessage} disabled={isProcessing()} />
        </div>
      </div>
    </div>
  )
}
