import { Splitter } from '@ark-ui/solid/splitter'
import { createSignal, createMemo, createUniqueId } from 'solid-js'
import { ChatInterface } from '~/components/ark-ui/ChatInterface'
import { SupportPanel, type GraphElement } from '~/components/ark-ui/SupportPanel'
import type { ContextEvent, UnifiedContext, ToolResultEventData } from '~/lib/harness-patterns'
import { executeCypherWrite } from '~/lib/neo4j/write-action'
import { mergeGraphElements } from '~/lib/graph-merge'
import type { StashAction } from '~/components/ark-ui/DataStashPanel'

export default function Home() {
  const sessionId = createUniqueId()
  const [graphElements, setGraphElements] = createSignal<GraphElement[]>([])
  const [highlightedIds, setHighlightedIds] = createSignal<string[]>([])
  const [contextEvents, setContextEvents] = createSignal<ContextEvent[]>([])
  const [unifiedContext, setUnifiedContext] = createSignal<UnifiedContext | undefined>(undefined)

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
      body: JSON.stringify({ sessionId, eventId, action }),
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
        {/* Chat Panel */}
        <Splitter.Panel id="chat">
          <ChatInterface
            sessionId={sessionId}
            onGraphUpdate={accumulateGraphElements}
            onEventsUpdate={accumulateEvents}
            onContextUpdate={setUnifiedContext}
            graphEntityNames={graphEntityNames()}
            onHighlightEntities={setHighlightedIds}
          />
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
            sessionId={sessionId}
            onStashAction={handleStashAction}
          />
        </Splitter.Panel>
      </Splitter.Root>
    </main>
  )
}
