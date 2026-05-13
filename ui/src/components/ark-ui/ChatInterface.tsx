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
 * - Per-session progress + run state lives in the parent route — see #47.
 *   The fetch loop captures `runSessionId` at submit time and routes ingest
 *   calls into the correct controller even after the user switches threads.
 */

import { createSignal, createEffect, createMemo, onMount } from 'solid-js'
import { ChatMessages, type Message } from './ChatMessages'
import { ChatInput } from './ChatInput'
import { AgentSelector } from './AgentSelector'
import { LiveProgressBar } from './LiveProgressBar'
import type { ChainProgressController } from './useChainProgress'
import {
  approveAction,
  rejectAction,
  loadConversation,
  extractGraphFromResult,
  extractGraphElements,
} from '~/lib/harness-client'
import { getSettings } from '~/lib/settings-store'
import { parseChatStream, type DoneEventData } from '~/lib/sse-client'
import type { GraphElement } from './SupportPanel'
import type { ContextEvent, UnifiedContext, ControllerActionEventData } from '~/lib/harness-patterns'

// ============================================================================
// Types
// ============================================================================

/**
 * Per-session UI run state. Lives at the route so progress and the submit
 * guard survive sidebar switches — see #47.
 */
export interface SessionRunState {
  /** A submit for this session is in flight (SSE stream open). */
  isProcessing: boolean
  /** Tool name from the latest `controller_action` event of the active loop.
   *  Drives the composer guard banner ("Waiting for `<tool>`…"). */
  runningTool: string | null
}

export interface ChatInterfaceProps {
  /** Session ID for server-side state (shared with SupportPanel for stash actions).
   *  When this changes, ChatInterface hydrates messages from persisted history. */
  sessionId: string
  onGraphUpdate?: (elements: GraphElement[]) => void
  onEventsUpdate?: (events: ContextEvent[]) => void
  onContextUpdate?: (ctx: UnifiedContext) => void
  /** Called before hydration so the parent can clear graph/event signals for the new thread. */
  onResetForNewSession?: () => void
  /** Called when the user changes agent — parent should mint a fresh sessionId so
   *  the new agent gets its own conversation row rather than overwriting an existing one. */
  onAgentChangeRequestsNewSession?: () => void
  /** Map of entity/relation names → graph element IDs for interactive highlighting */
  graphEntityNames?: Map<string, string[]>
  /** Callback to highlight specific graph element IDs */
  onHighlightEntities?: (ids: string[]) => void
  // ---- Per-session progress + run state (lives in the route, see #47) ----
  getProgress: (sessionId: string) => ChainProgressController
  getRunState: (sessionId: string) => SessionRunState
  updateRunState: (sessionId: string, patch: Partial<SessionRunState>) => void
  registerAbortController: (sessionId: string, ac: AbortController) => void
  unregisterAbortController: (sessionId: string) => void
  /** Push-driven sidebar title update — fired when the server emits a
   *  `title_updated` SSE event after the first-turn LLM title resolves.
   *  Route patches its threads cache in-place; no refetch required. */
  onTitleUpdated?: (sessionId: string, title: string) => void
  /** Monotonic token forwarded to ChatInput — every change focuses the
   *  composer textarea (used to land focus there after `+ New Chat`). */
  focusInputToken?: number
}

const WELCOME_MESSAGE: Message = {
  id: 'welcome',
  role: 'assistant',
  content: 'Hello! I\'m your knowledge assistant. I can help you:\n\n- Query and explore your Knowledge Base\n- Create new observations\n- Analyze patterns and connections\n- Use additional tools\n\nSelect an agent from the dropdown above, then ask me anything!',
  timestamp: new Date(),
}

// ============================================================================
// Component
// ============================================================================

export const ChatInterface = (props: ChatInterfaceProps) => {
  const [messages, setMessages] = createSignal<Message[]>([])
  const [selectedAgent, setSelectedAgent] = createSignal('default')
  // Cursor into ctx.events — tracks how many events were sent last turn so we
  // emit only the delta (new events) rather than the full accumulated history
  let prevEventCount = 0

  // Reactive accessors into the per-session registries owned by the route.
  // Re-reading `props.sessionId` inside the memo means snapshot/run-state
  // tracking automatically swaps when the user picks a different thread.
  const currentProgress = createMemo(() => props.getProgress(props.sessionId))
  const currentSnapshot = () => currentProgress().snapshot()
  const currentRunState = () => props.getRunState(props.sessionId)
  const isProcessing = () => currentRunState().isProcessing
  const runningTool = () => currentRunState().runningTool

  onMount(() => {
    setMessages([WELCOME_MESSAGE])
  })

  // When the parent swaps in a different sessionId (sidebar selection or
  // "+ New Chat"), reset local state and try to rehydrate from persisted
  // history. Brand-new sessions throw and we fall through to the welcome msg.
  createEffect(() => {
    const sid = props.sessionId
    setMessages([])
    prevEventCount = 0
    props.onResetForNewSession?.()

    loadConversation(sid)
      .then((loaded) => {
        setSelectedAgent(loaded.agentId)
        setMessages(
          loaded.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: new Date(m.timestamp),
          }))
        )

        // Replay events to parent so graph + observability repopulate.
        try {
          const ctx = JSON.parse(loaded.serialized) as UnifiedContext
          const events = ctx.events ?? []
          prevEventCount = events.length
          if (props.onEventsUpdate && events.length) {
            props.onEventsUpdate(events)
          }
          if (props.onGraphUpdate) {
            const toolEvents = events.filter((e) => e.type === 'tool_result')
            const els = extractGraphElements(toolEvents)
            if (els.length) props.onGraphUpdate(els)
          }
          if (props.onContextUpdate) {
            props.onContextUpdate(ctx)
          }
        } catch (err) {
          console.warn('[ChatInterface] failed to replay events:', err)
        }
      })
      .catch(() => {
        // Either a brand-new session id or no row yet — show welcome.
        setMessages([WELCOME_MESSAGE])
      })
  })

  const handleAgentChange = (agentId: string) => {
    // Switching agent starts a new conversation under the new agent rather
    // than mutating the existing row's agent_id. Parent mints the new id.
    setSelectedAgent(agentId)
    props.onAgentChangeRequestsNewSession?.()
  }

  const handleSendMessage = async (content: string) => {
    // Snapshot the active sessionId at submit time. The user may switch
    // threads mid-stream; without this, late-arriving events would corrupt
    // whichever thread happens to be in view (#47).
    const runSessionId = props.sessionId

    // Per-session progress controller — owned by the route registry so it
    // survives the user navigating away to a different chat.
    const progress = props.getProgress(runSessionId)
    progress.reset()
    props.updateRunState(runSessionId, { isProcessing: true, runningTool: null })

    // Add user message — only if we're still on this thread. (If the user
    // submits, then immediately switches, the local view belongs to the new
    // thread and we should not pollute it with the old message.)
    if (runSessionId === props.sessionId) {
      const userMessage: Message = {
        id: Date.now().toString(),
        role: 'user',
        content,
        timestamp: new Date()
      }
      setMessages([...messages(), userMessage])
    }

    const abortController = new AbortController()
    props.registerAbortController(runSessionId, abortController)

    try {
      // Stream events via SSE endpoint for real-time updates
      const response = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: runSessionId,
          message: content,
          agentId: selectedAgent(),
          settings: getSettings()
        }),
        signal: abortController.signal,
      })

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`)
      }

      let finalResult: DoneEventData | null = null

      // Typed SSE iteration — the parser handles frame buffering, malformed
      // JSON, partial reads, and yields discriminated `ChatStreamEvent`s.
      for await (const sseEvt of parseChatStream(response)) {
        if (sseEvt.event === 'done') {
          finalResult = sseEvt.data as DoneEventData
          continue
        }
        if (sseEvt.event === 'error') {
          throw new Error((sseEvt.data as { error: string }).error)
        }
        if (sseEvt.event === 'title_updated') {
          // Server pushed the LLM-generated title for this conversation —
          // patch the sidebar's threads cache in place. Lands regardless of
          // which thread the user is currently viewing.
          const { sessionId: sid, title } = sseEvt.data
          props.onTitleUpdated?.(sid, title)
          continue
        }
        if (sseEvt.event !== 'message') continue // Forward-compat: ignore unknown event names

        const evt = sseEvt.data as ContextEvent

        // Progress is always routed into the captured run session's
        // controller, even if the user has navigated away.
        progress.ingest(evt)

        // Surface the currently-running tool for the composer guard.
        if (evt.type === 'controller_action') {
          const data = evt.data as ControllerActionEventData
          const toolName = data.action?.tool_name
          if (toolName && toolName !== 'Return') {
            props.updateRunState(runSessionId, { runningTool: toolName })
          } else if (data.action?.is_final) {
            props.updateRunState(runSessionId, { runningTool: null })
          }
        }

        // The remaining route-level state (events, graph, messages) is
        // only owned by the actively-displayed session — drop events
        // from a backgrounded stream rather than corrupt the view. The
        // server-side persistence catches everything up on rehydrate.
        if (runSessionId !== props.sessionId) continue

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

        // Convert error events to inline chat messages
        if (evt.type === 'error') {
          const errorData = evt.data as { error: string; severity?: string; hint?: string; turn?: number; iteration?: number }
          // Build context string (e.g., "(turn 3, attempt 2)")
          const parts: string[] = []
          if (errorData.turn !== undefined) parts.push(`turn ${errorData.turn + 1}`)
          if (errorData.iteration !== undefined) parts.push(`attempt ${errorData.iteration + 1}`)
          const turnInfo = parts.length > 0 ? `(${parts.join(', ')})` : undefined
          const errorMsg: Message = {
            id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            role: errorData.severity === 'recoverable' ? 'warning' : 'error',
            content: errorData.error,
            timestamp: new Date(),
            hint: errorData.hint,
            patternId: evt.patternId,
            turnInfo,
          }
          setMessages([...messages(), errorMsg])
        }
      }

      // Mark progress complete — bar fills, fades, and unmounts.
      progress.finish()

      // Update event count cursor and emit final context — but only if the
      // user is still looking at this thread.
      if (finalResult?.context) {
        prevEventCount = finalResult.context.events?.length ?? 0
        if (runSessionId === props.sessionId && props.onContextUpdate) {
          props.onContextUpdate(finalResult.context as UnifiedContext)
        }
      }

      // Build assistant message from final result — only if there's a real response
      // (not an error status with empty/stale response). Drop it silently if the
      // user has switched away; the persisted row will surface it on reload.
      const finalResponse = finalResult?.response ?? ''
      if (runSessionId === props.sessionId && finalResponse && finalResult?.status !== 'error') {
        const assistantMessage: Message = {
          id: Date.now().toString(),
          role: 'assistant',
          content: finalResponse,
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
      }
    } catch (error) {
      // Suppress the noisy AbortError that fires on page-unload teardown.
      const aborted = error instanceof DOMException && error.name === 'AbortError'
      if (!aborted) {
        console.error('Error processing message:', error)
        if (runSessionId === props.sessionId) {
          const errorMessage: Message = {
            id: Date.now().toString(),
            role: 'error',
            content: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date()
          }
          setMessages([...messages(), errorMessage])
        }
      }
      progress.finish()
    } finally {
      props.updateRunState(runSessionId, { isProcessing: false, runningTool: null })
      props.unregisterAbortController(runSessionId)
    }
  }

  const handleApproveWrite = async (messageId: string) => {
    props.updateRunState(props.sessionId, { isProcessing: true })

    try {
      // Execute the approved operation
      const result = await approveAction(props.sessionId)

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
      props.updateRunState(props.sessionId, { isProcessing: false })
    }
  }

  const handleRejectWrite = async (messageId: string) => {
    try {
      // Reject the pending operation
      const result = await rejectAction(props.sessionId)

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

  // Composer guard banner — set when the active session has a tool in flight.
  const blockedMessage = () => {
    const tool = runningTool()
    if (!isProcessing() || !tool) return undefined
    return `Waiting for \`${tool}\` to complete. Try later.`
  }

  return (
    <div flex="~ col" h="full" bg="dark-bg-secondary">
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

        {/* Messages — the live progress bar rides as a trailing slot so it
            appears where the next assistant bubble will land, then animates
            out as that bubble takes its place. */}
        <ChatMessages
          messages={messages()}
          onApproveWrite={handleApproveWrite}
          onRejectWrite={handleRejectWrite}
          graphEntityNames={props.graphEntityNames}
          onHighlightEntities={props.onHighlightEntities}
          trailing={() => (
            <LiveProgressBar
              status={currentSnapshot().status}
              current={currentSnapshot().currentTurn}
              pathProjection={currentSnapshot().pathProjection}
              maxProjection={currentSnapshot().maxProjection}
              visible={
                isProcessing() &&
                !currentSnapshot().done &&
                currentSnapshot().maxProjection > 0
              }
            />
          )}
        />

      {/* Input */}
      <div border="t dark-border-primary" p="4" bg="dark-bg-secondary/80" backdrop-blur="sm">
        <ChatInput
          onSend={handleSendMessage}
          disabled={isProcessing()}
          blockedMessage={blockedMessage()}
          focusToken={props.focusInputToken}
        />
      </div>
    </div>
  )
}
