import { Splitter } from '@ark-ui/solid/splitter'
import { createSignal } from 'solid-js'
import { ChatInterface } from '~/components/ark-ui/ChatInterface'
import { SupportPanel, type GraphElement } from '~/components/ark-ui/SupportPanel'
import type { ContextEvent } from '~/lib/harness-patterns'

export default function Home() {
  const [graphElements, setGraphElements] = createSignal<GraphElement[]>([])
  const [highlightedIds, setHighlightedIds] = createSignal<string[]>([])
  const [contextEvents, setContextEvents] = createSignal<ContextEvent[]>([])

  // Accumulate graph elements across calls (deduplicate by ID)
  const accumulateGraphElements = (newElements: GraphElement[]) => {
    setGraphElements(prev => {
      const existingIds = new Set(prev.map(e => e.data?.id))
      const uniqueNew = newElements.filter(e => !existingIds.has(e.data?.id))
      return [...prev, ...uniqueNew]
    })
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
  }

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
            onGraphUpdate={accumulateGraphElements}
            onEventsUpdate={accumulateEvents}
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
            onClearGraph={clearGraph}
            onClearEvents={clearEvents}
          />
        </Splitter.Panel>
      </Splitter.Root>
    </main>
  )
}
