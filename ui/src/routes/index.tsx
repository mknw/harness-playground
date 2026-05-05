import { Splitter } from '@ark-ui/solid/splitter'
import { createSignal, createMemo, createResource, createUniqueId } from 'solid-js'
import { ChatInterface } from '~/components/ark-ui/ChatInterface'
import { ChatSidebar } from '~/components/ark-ui/ChatSidebar'
import { SupportPanel, type GraphElement } from '~/components/ark-ui/SupportPanel'
import type { ContextEvent, UnifiedContext, ToolResultEventData } from '~/lib/harness-patterns'
import { executeCypherWrite } from '~/lib/neo4j/write-action'
import { mergeGraphElements } from '~/lib/graph-merge'
import { listConversations } from '~/lib/harness-client'
import type { StashAction } from '~/components/ark-ui/DataStashPanel'

export default function Home() {
  // Conversation a user is currently viewing. Initial value is a fresh id so
  // the first message creates a new persisted row; switching threads via the
  // sidebar (or "+ New Chat") swaps this signal.
  const [selectedSessionId, setSelectedSessionId] = createSignal(createUniqueId())
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false)

  const [graphElements, setGraphElements] = createSignal<GraphElement[]>([])
  const [highlightedIds, setHighlightedIds] = createSignal<string[]>([])
  const [contextEvents, setContextEvents] = createSignal<ContextEvent[]>([])
  const [unifiedContext, setUnifiedContext] = createSignal<UnifiedContext | undefined>(undefined)

  // Sidebar threads — refetched after each turn completes (see onContextUpdate).
  const [threads, { refetch: refetchThreads }] = createResource(() => listConversations())

  // Accumulate graph elements across calls. Dedup + touched-flag refresh logic
  // lives in `mergeGraphElements` so it can be unit-tested in isolation.
  const accumulateGraphElements = (newElements: GraphElement[]) => {
    setGraphElements(prev => mergeGraphElements(prev, newElements))
    // Track newly added IDs for highlighting
    const newIds = newElements.map(e => e.data?.id).filter((id): id is string => !!id)
    setHighlightedIds(newIds)
  }

  // Accumulate context events
  const accumulateEvents = (newEvents: ContextEvent[]) => {
    setContextEvents(prev => [...prev, ...newEvents])
  }

  // Clear all graph elements
  const clearGraph = () => {
    setGraphElements([])
    setHighlightedIds([])
  }

  // Clear all events
  const clearEvents = () => {
    setContextEvents([])
    setUnifiedContext(undefined)
  }

  // Wipe per-conversation state. Called by ChatInterface before it hydrates a
  // newly selected sessionId so the graph + observability tabs don't keep
  // showing stale data from the previous thread.
  const resetForNewSession = () => {
    clearGraph()
    clearEvents()
  }

  const handleNewChat = () => {
    resetForNewSession()
    setSelectedSessionId(createUniqueId())
  }

  const handleSelectThread = (threadId: string) => {
    if (threadId === selectedSessionId()) return
    resetForNewSession()
    setSelectedSessionId(threadId)
  }

  // Wrap the supplied unified-context setter so each save also refreshes the
  // sidebar list (titles update once the first user_message lands).
  const handleContextUpdate = (ctx: UnifiedContext) => {
    setUnifiedContext(ctx)
    refetchThreads()
  }

  // Execute Cypher write from graph UI (node edit, relation create)
  const handleCypherWrite = async (cypher: string, params?: Record<string, unknown>) => {
    try {
      await executeCypherWrite(cypher, params)
    } catch (error) {
      console.error('Cypher write failed:', error)
    }
  }

  // Handle data stash actions (hide/unhide/archive/unarchive)
  const handleStashAction = async (eventId: string, action: StashAction) => {
    // Optimistic UI update: mutate local signal immediately
    setContextEvents(prev => prev.map(e => {
      if (e.id !== eventId || e.type !== 'tool_result') return e
      const d = { ...(e.data as ToolResultEventData) }
      if (action === 'hide') d.hidden = true
      if (action === 'unhide') d.hidden = false
      if (action === 'archive') { d.archived = true; d.hidden = false }
      if (action === 'unarchive') d.archived = false
      return { ...e, data: d }
    }))

    // Persist to server
    await fetch('/api/stash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: selectedSessionId(), eventId, action }),
    })
  }

  // Build a set of known entity names/labels from graph elements for chat highlighting
  const graphEntityNames = createMemo(() => {
    const names = new Map<string, string[]>() // name → [id1, id2, ...]
    for (const el of graphElements()) {
      const d = el.data
      if (!d?.id) continue
      const label = d.label as string | undefined
      if (label && !d.source) { // node, not edge
        const existing = names.get(label) ?? []
        existing.push(d.id as string)
        names.set(label, existing)
      }
    }
    // Also index edge labels → edge IDs
    for (const el of graphElements()) {
      const d = el.data
      if (!d?.id || !d.source) continue // skip nodes
      const label = d.label as string | undefined
      if (label) {
        const existing = names.get(label) ?? []
        existing.push(d.id as string)
        names.set(label, existing)
      }
    }
    return names
  })

  return (
    <main h="[calc(100vh-4rem)]">
      <Splitter.Root
        orientation="horizontal"
        defaultSize={[60, 40]}
        panels={[
          { id: 'chat', collapsible: true, minSize: 40, maxSize: 80 },
          { id: 'support', collapsible: true, minSize: 30, maxSize: 60 }
        ]}
        h="full"
      >
        {/* Chat Panel — sidebar lives at this level so thread selection can
            swap the sessionId fed into ChatInterface. */}
        <Splitter.Panel id="chat">
          <div flex="~" h="full">
            <ChatSidebar
              collapsed={sidebarCollapsed()}
              onToggle={() => setSidebarCollapsed(!sidebarCollapsed())}
              threads={threads() ?? []}
              selectedId={selectedSessionId()}
              onSelectThread={handleSelectThread}
              onNewChat={handleNewChat}
            />
            <div flex="1" overflow="hidden">
              <ChatInterface
                sessionId={selectedSessionId()}
                onGraphUpdate={accumulateGraphElements}
                onEventsUpdate={accumulateEvents}
                onContextUpdate={handleContextUpdate}
                onResetForNewSession={resetForNewSession}
                onAgentChangeRequestsNewSession={handleNewChat}
                graphEntityNames={graphEntityNames()}
                onHighlightEntities={setHighlightedIds}
              />
            </div>
          </div>
        </Splitter.Panel>

        {/* Resize Trigger */}
        <Splitter.ResizeTrigger
          id="chat:support"
          w="2"
          bg="dark-border-primary hover:neon-cyan/50"
          cursor="col-resize"
          transition="all"
          shadow="hover:[0_0_10px_rgba(0,255,255,0.3)]"
        />

        {/* Support Panel (Graph, Stats, Actions, Docs, Tools) */}
        <Splitter.Panel id="support">
          <SupportPanel
            graphElements={graphElements()}
            highlightedIds={highlightedIds()}
            contextEvents={contextEvents()}
            unifiedContext={unifiedContext()}
            onClearGraph={clearGraph}
            onClearEvents={clearEvents}
            onCypherWrite={handleCypherWrite}
            sessionId={selectedSessionId()}
            onStashAction={handleStashAction}
          />
        </Splitter.Panel>
      </Splitter.Root>
    </main>
  )
}
