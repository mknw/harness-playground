import { Splitter } from '@ark-ui/solid/splitter'
import { ChatInterface } from '~/components/ark-ui/ChatInterface'
import { KnowledgeGraphPanel } from '~/components/ark-ui/KnowledgeGraphPanel'

export default function Home() {
  return (
    <main h="[calc(100vh-4rem)]">
      <Splitter.Root
        orientation="horizontal"
        defaultSize={[60, 40]}
        panels={[
          { id: 'chat', collapsible: true, minSize: 40, maxSize: 80 },
          { id: 'graph', collapsible: true, minSize: 30, maxSize: 60 }
        ]}
        h="full"
      >
        {/* Chat Panel */}
        <Splitter.Panel id="chat">
          <ChatInterface />
        </Splitter.Panel>

        {/* Resize Trigger */}
        <Splitter.ResizeTrigger
          id="chat:graph"
          w="2"
          bg="dark-border-primary hover:neon-cyan/50"
          cursor="col-resize"
          transition="all"
          shadow="hover:[0_0_10px_rgba(0,255,255,0.3)]"
        />

        {/* Knowledge Graph Panel */}
        <Splitter.Panel id="graph">
          <KnowledgeGraphPanel />
        </Splitter.Panel>
      </Splitter.Root>
    </main>
  )
}
