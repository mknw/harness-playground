/**
 * ObservabilityPanel Component
 *
 * Displays ContextEvents in a timeline format with expandable detail panels.
 * Events are displayed chronologically from top (oldest) to bottom (newest).
 * Pattern enter/exit rows are compact dividers; events within a pattern
 * are tinted with the pattern's colour from pattern-colors.json.
 */

import { For, Show, createSignal, createMemo, Switch, Match } from 'solid-js'
import type {
  ContextEvent,
  EventType,
  ToolCallEventData,
  ToolResultEventData,
  ControllerActionEventData,
  UserMessageEventData,
  AssistantMessageEventData,
  ApprovalRequestEventData,
  ErrorEventData,
  LLMCallData
} from '~/lib/harness-patterns'
import patternColorsJson from '../../../pattern-colors.json'

interface ObservabilityPanelProps {
  events: ContextEvent[]
  onClear?: () => void
}

// ============================================================================
// Pattern Colors (loaded from pattern-colors.json)
// ============================================================================

interface PatternColorEntry { color: string; tint: string }

const patternColors = patternColorsJson as unknown as Record<string, PatternColorEntry>
const defaultPatternColor: PatternColorEntry = patternColors._default ?? { color: '#94a3b8', tint: 'rgba(148,163,184,0.06)' }

function getPatternColor(patternId: string): PatternColorEntry {
  return patternColors[patternId] ?? defaultPatternColor
}

// ============================================================================
// Event Icons and Colors
// ============================================================================

const eventIcons: Record<EventType, string> = {
  user_message: '💬',
  assistant_message: '🤖',
  tool_call: '🔧',
  tool_result: '📥',
  controller_action: '🎯',
  critic_result: '📝',
  pattern_enter: '▶',
  pattern_exit: '■',
  approval_request: '⏸️',
  approval_response: '✅',
  error: '❌'
}

const eventColors: Record<EventType, string> = {
  user_message: '#60a5fa',      // blue-400
  assistant_message: '#34d399', // green-400
  tool_call: '#a78bfa',         // violet-400
  tool_result: '#22d3ee',       // cyan-400
  controller_action: '#fbbf24', // amber-400
  critic_result: '#f472b6',     // pink-400
  pattern_enter: '#94a3b8',     // overridden per-pattern
  pattern_exit: '#94a3b8',      // overridden per-pattern
  approval_request: '#f97316',  // orange-500
  approval_response: '#10b981', // emerald-500
  error: '#ef4444'              // red-500
}

// ============================================================================
// Helper Functions
// ============================================================================

function getEventPreview(type: EventType, data: unknown): string {
  switch (type) {
    case 'tool_call': {
      const d = data as ToolCallEventData
      return d.tool
    }
    case 'tool_result': {
      const d = data as ToolResultEventData
      return `${d.tool}: ${d.success ? 'ok' : 'error'}`
    }
    case 'controller_action': {
      const d = data as ControllerActionEventData
      return d.action.tool_name
    }
    case 'user_message':
    case 'assistant_message': {
      const d = data as { content: string }
      const content = d.content || ''
      return content.length > 50 ? content.slice(0, 50) + '...' : content
    }
    case 'approval_request': {
      const d = data as ApprovalRequestEventData
      return d.request.action
    }
    case 'error': {
      const d = data as ErrorEventData
      return d.error.slice(0, 50)
    }
    case 'pattern_enter':
    case 'pattern_exit':
      return ''
    default:
      return ''
  }
}

function getEventLane(type: EventType): 'interface' | 'tools' {
  switch (type) {
    case 'user_message':
    case 'assistant_message':
    case 'pattern_enter':
    case 'pattern_exit':
    case 'approval_request':
    case 'approval_response':
      return 'interface'
    default:
      return 'tools'
  }
}

// ============================================================================
// Summary Bar Component
// ============================================================================

const SummaryBar = (props: { events: ContextEvent[], onClear?: () => void }) => {
  const metrics = createMemo(() => {
    const events = props.events
    const toolResults = events.filter(e => e.type === 'tool_result')
    const successCount = toolResults.filter(e => (e.data as ToolResultEventData).success).length
    const errorCount = events.filter(e => e.type === 'error').length

    return {
      totalEvents: events.length,
      successRate: toolResults.length > 0 ? successCount / toolResults.length : 1,
      errorCount
    }
  })

  return (
    <div
      p="3"
      bg="dark-bg-tertiary"
      border="b dark-border-primary"
      flex="~ wrap"
      gap="4"
    >
      <div flex="~" items="center" gap="2">
        <span text="xs dark-text-tertiary">Events:</span>
        <span text="sm dark-text-primary" font="mono">{metrics().totalEvents}</span>
      </div>

      <div flex="~" items="center" gap="2">
        <span text="xs dark-text-tertiary">Success:</span>
        <span
          text={`sm ${metrics().successRate >= 0.9 ? 'neon-green' : metrics().successRate >= 0.5 ? 'neon-yellow' : 'red-500'}`}
          font="mono"
        >
          {Math.round(metrics().successRate * 100)}%
        </span>
      </div>

      <Show when={metrics().errorCount > 0}>
        <div flex="~" items="center" gap="2">
          <span text="xs dark-text-tertiary">Errors:</span>
          <span text="sm red-400" font="mono">{metrics().errorCount}</span>
        </div>
      </Show>

      <Show when={props.events.length > 0}>
        <button
          onClick={() => props.onClear?.()}
          m="l-auto"
          p="x-2 y-1"
          text="xs red-400"
          bg="red-600/10 hover:red-600/20"
          border="1 red-500/30"
          rounded="md"
          cursor="pointer"
          transition="all"
        >
          Clear
        </button>
      </Show>
    </div>
  )
}

// ============================================================================
// Pattern Enter/Exit Row (compact divider)
// ============================================================================

const PatternBoundaryRow = (props: { event: ContextEvent }) => {
  const { type, patternId } = props.event
  const isEnter = type === 'pattern_enter'
  const pc = getPatternColor(patternId)

  return (
    <div
      flex="~"
      items="center"
      gap="2"
      p="x-3 y-1"
      style={{
        'background-color': pc.tint,
        'border-top': isEnter ? `1px solid ${pc.color}40` : 'none',
        'border-bottom': !isEnter ? `1px solid ${pc.color}40` : 'none',
        'min-height': '24px'
      }}
    >
      <span
        style={{
          color: pc.color,
          'font-size': '9px',
          'line-height': '1'
        }}
      >
        {isEnter ? '▶' : '■'}
      </span>
      <span
        style={{
          color: pc.color,
          'font-size': '10px',
          'font-family': '"Fira Code", ui-monospace, monospace',
          'font-weight': '500'
        }}
      >
        {patternId}
      </span>
      <span
        style={{
          color: `${pc.color}99`,
          'font-size': '9px',
          'font-family': '"Fira Code", ui-monospace, monospace'
        }}
      >
        {isEnter ? 'enter' : 'exit'}
      </span>
    </div>
  )
}

// ============================================================================
// Event Row Component
// ============================================================================

const EventRow = (props: {
  event: ContextEvent
  index: number
  expanded: boolean
  onExpand: () => void
  bgTint?: string
}) => {
  const { type, patternId, data } = props.event
  const icon = eventIcons[type]
  const preview = getEventPreview(type, data)
  const lane = getEventLane(type)
  const color = eventColors[type]

  const NodeContent = () => (
    <div
      flex="~ col"
      items="center"
      gap="1"
      p="2 3"
      cursor="pointer"
      bg={props.expanded ? 'dark-bg-tertiary' : 'transparent hover:dark-bg-hover'}
      border={props.expanded ? '1 neon-cyan/30' : 'none'}
      rounded="md"
      transition="all"
      onClick={props.onExpand}
      w="full"
    >
      {/* Icon */}
      <span text="lg">{icon}</span>

      {/* Event type */}
      <div
        style={{
          color,
          'font-size': '11px',
          'font-family': '"Fira Code", ui-monospace, monospace',
          'font-weight': '500',
          'text-align': 'center'
        }}
      >
        {type.replace(/_/g, ' ')}
      </div>

      {/* Pattern ID */}
      <Show when={patternId && patternId !== 'harness'}>
        <div text="xs dark-text-tertiary" font="mono">
          {patternId}
        </div>
      </Show>

      {/* Preview */}
      <Show when={preview}>
        <div
          text="xs dark-text-secondary"
          max-w="120px"
          overflow="hidden"
          style={{ 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }}
        >
          {preview}
        </div>
      </Show>
    </div>
  )

  return (
    <div
      flex="~"
      min-h="70px"
      border="b dark-border-secondary/30"
      style={{ 'background-color': props.bgTint ?? 'transparent' }}
    >
      {/* Interface Lane (left) */}
      <div
        w="1/2"
        flex="~"
        justify="center"
        items="center"
        border="r dark-border-secondary/30"
      >
        <Show when={lane === 'interface'}>
          <NodeContent />
        </Show>
      </div>

      {/* Tools Lane (right) */}
      <div
        w="1/2"
        flex="~"
        justify="center"
        items="center"
      >
        <Show when={lane === 'tools'}>
          <NodeContent />
        </Show>
      </div>
    </div>
  )
}

// ============================================================================
// Lane Headers Component
// ============================================================================

const LaneHeaders = () => (
  <div
    flex="~"
    border="b dark-border-primary"
    bg="dark-bg-secondary"
    style={{ position: 'sticky', top: '0', 'z-index': '10' }}
  >
    {/* Interface Lane Header */}
    <div
      w="1/2"
      p="2"
      flex="~"
      items="center"
      justify="center"
      gap="2"
      border="r dark-border-secondary"
    >
      <div w="2" h="2" rounded="full" bg="cyber-500" />
      <span text="xs dark-text-primary" font="medium">Interface</span>
    </div>

    {/* Tools Lane Header */}
    <div
      w="1/2"
      p="2"
      flex="~"
      items="center"
      justify="center"
      gap="2"
    >
      <div w="2" h="2" rounded="full" bg="neon-cyan" />
      <span text="xs dark-text-primary" font="medium">Tools</span>
    </div>
  </div>
)

// ============================================================================
// Empty State Component
// ============================================================================

const EmptyState = () => (
  <div
    flex="~ col"
    items="center"
    justify="center"
    h="full"
    p="8"
    text="center"
  >
    <svg
      width="48"
      height="48"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      style={{ color: '#4f46e5', opacity: 0.4 }}
    >
      <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
    <div text="sm dark-text-secondary" m="t-3">
      No events yet
    </div>
    <div text="xs dark-text-tertiary" m="t-1">
      Send a message to see the timeline
    </div>
  </div>
)

// ============================================================================
// Event Detail Components
// ============================================================================

const ToolCallDetail = (props: { data: ToolCallEventData }) => (
  <div flex="~ col" gap="3">
    <div>
      <div text="xs dark-text-tertiary" m="b-1">Tool</div>
      <div text="sm neon-cyan" font="mono">{props.data.tool}</div>
    </div>
    <div>
      <div text="xs dark-text-tertiary" m="b-1">Arguments</div>
      <pre
        text="xs dark-text-primary"
        bg="dark-bg-tertiary"
        p="3"
        rounded="md"
        overflow="auto"
        max-h="300px"
      >
        {JSON.stringify(props.data.args, null, 2)}
      </pre>
    </div>
  </div>
)

const ToolResultDetail = (props: { data: ToolResultEventData }) => (
  <div flex="~ col" gap="3">
    <div>
      <div text="xs dark-text-tertiary" m="b-1">Tool</div>
      <div text="sm neon-cyan" font="mono">{props.data.tool}</div>
    </div>
    <div>
      <div text="xs dark-text-tertiary" m="b-1">Status</div>
      <div
        text={`sm ${props.data.success ? 'neon-green' : 'red-400'}`}
        font="medium"
      >
        {props.data.success ? 'Success' : `Error: ${props.data.error}`}
      </div>
    </div>
    <div>
      <div text="xs dark-text-tertiary" m="b-1">Result</div>
      <pre
        text="xs dark-text-primary"
        bg="dark-bg-tertiary"
        p="3"
        rounded="md"
        overflow="auto"
        max-h="300px"
      >
        {JSON.stringify(props.data.result, null, 2)}
      </pre>
    </div>
  </div>
)

const ActionDetail = (props: { data: ControllerActionEventData }) => (
  <div flex="~ col" gap="3">
    <div>
      <div text="xs dark-text-tertiary" m="b-1">Tool</div>
      <div text="sm neon-cyan" font="mono">{props.data.action.tool_name}</div>
    </div>
    <Show when={props.data.action.reasoning}>
      <div>
        <div text="xs dark-text-tertiary" m="b-1">Reasoning</div>
        <div text="sm dark-text-primary">{props.data.action.reasoning}</div>
      </div>
    </Show>
    <div>
      <div text="xs dark-text-tertiary" m="b-1">Arguments</div>
      <pre
        text="xs dark-text-primary"
        bg="dark-bg-tertiary"
        p="3"
        rounded="md"
        overflow="auto"
        max-h="200px"
      >
        {props.data.action.tool_args}
      </pre>
    </div>
    <div flex="~" gap="4">
      <div>
        <div text="xs dark-text-tertiary" m="b-1">Final</div>
        <div text="sm dark-text-primary">{props.data.action.is_final ? 'Yes' : 'No'}</div>
      </div>
      <Show when={props.data.action.status}>
        <div>
          <div text="xs dark-text-tertiary" m="b-1">Status</div>
          <div text="sm dark-text-primary">{props.data.action.status}</div>
        </div>
      </Show>
    </div>
  </div>
)

const MessageDetail = (props: { data: { content: string }, role: 'user' | 'assistant' }) => (
  <div flex="~ col" gap="3">
    <div>
      <div text="xs dark-text-tertiary" m="b-1">Role</div>
      <div text="sm dark-text-primary" font="medium">{props.role}</div>
    </div>
    <div>
      <div text="xs dark-text-tertiary" m="b-1">Content</div>
      <div
        text="sm dark-text-primary"
        bg="dark-bg-tertiary"
        p="3"
        rounded="md"
        style={{ 'white-space': 'pre-wrap' }}
      >
        {props.data.content}
      </div>
    </div>
  </div>
)

const GenericDetail = (props: { data: unknown }) => (
  <div>
    <div text="xs dark-text-tertiary" m="b-2">Data</div>
    <pre
      text="xs dark-text-primary"
      bg="dark-bg-tertiary"
      p="3"
      rounded="md"
      overflow="auto"
      max-h="400px"
    >
      {JSON.stringify(props.data, null, 2)}
    </pre>
  </div>
)

// ============================================================================
// Shared Components
// ============================================================================

const CodeBlock = (props: { content: string | undefined; placeholder?: string }) => (
  <pre
    text="xs dark-text-primary"
    bg="dark-bg-tertiary"
    p="3"
    rounded="md"
    overflow="auto"
    max-h="300px"
    style={{ 'white-space': 'pre-wrap', 'word-break': 'break-word' }}
  >
    {props.content ?? props.placeholder ?? 'Not captured'}
  </pre>
)

// ============================================================================
// Parsed Prompt View Component
// ============================================================================

interface ParsedMessage {
  role: string
  content: string
}

const roleColors: Record<string, string> = {
  system: '#a78bfa',    // violet-400
  user: '#60a5fa',      // blue-400
  assistant: '#34d399', // green-400
  tool: '#22d3ee'       // cyan-400
}

/** Parse OpenAI-compatible HTTP body into structured messages + metadata */
function parsePromptBody(rawInput: string): { messages: ParsedMessage[]; model?: string; params: Record<string, unknown> } | null {
  try {
    const body = JSON.parse(rawInput)
    if (!body || typeof body !== 'object' || !Array.isArray(body.messages)) return null

    const messages: ParsedMessage[] = body.messages.map((m: { role?: string; content?: unknown }) => ({
      role: String(m.role ?? 'unknown'),
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content, null, 2)
    }))

    // Extract non-message params
    const { messages: _, model, ...rest } = body
    return { messages, model, params: rest }
  } catch {
    return null
  }
}

const PromptMessage = (props: { msg: ParsedMessage }) => {
  const color = () => roleColors[props.msg.role] ?? '#94a3b8'

  return (
    <div
      border="1 dark-border-secondary/40"
      rounded="md"
      overflow="hidden"
    >
      {/* Role badge */}
      <div
        p="x-3 y-1.5"
        flex="~"
        items="center"
        gap="2"
        style={{ 'border-bottom': '1px solid rgba(148,163,184,0.15)' }}
        bg="dark-bg-tertiary"
      >
        <div
          w="2"
          h="2"
          rounded="full"
          style={{ 'background-color': color() }}
        />
        <span
          text="xs"
          font="mono medium"
          style={{ color: color() }}
        >
          {props.msg.role}
        </span>
      </div>
      {/* Content */}
      <pre
        text="xs dark-text-primary"
        p="3"
        m="0"
        overflow="auto"
        max-h="250px"
        style={{ 'white-space': 'pre-wrap', 'word-break': 'break-word' }}
      >
        {props.msg.content}
      </pre>
    </div>
  )
}

const ParsedPromptView = (props: { rawInput: string }) => {
  const parsed = () => parsePromptBody(props.rawInput)

  return (
    <Show
      when={parsed()}
      fallback={<CodeBlock content={props.rawInput} placeholder="Parsed prompt not captured" />}
    >
      {(p) => (
        <div flex="~ col" gap="3">
          {/* Model & params bar */}
          <Show when={p().model || Object.keys(p().params).length > 0}>
            <div
              flex="~ wrap"
              gap="4"
              items="center"
              bg="dark-bg-tertiary"
              p="2 3"
              rounded="md"
              text="xs"
            >
              <Show when={p().model}>
                <div flex="~ col" gap="0.5">
                  <span text="dark-text-tertiary">Model</span>
                  <span text="dark-text-primary" font="mono">{p().model}</span>
                </div>
              </Show>
              <For each={Object.entries(p().params).filter(([k]) => !['stream', 'stream_options'].includes(k))}>
                {([key, val]) => (
                  <div flex="~ col" gap="0.5">
                    <span text="dark-text-tertiary">{key}</span>
                    <span text="dark-text-primary" font="mono">
                      {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Show>

          {/* Messages */}
          <div flex="~ col" gap="2">
            <div text="xs dark-text-tertiary">{p().messages.length} message{p().messages.length !== 1 ? 's' : ''}</div>
            <For each={p().messages}>
              {(msg) => <PromptMessage msg={msg} />}
            </For>
          </div>
        </div>
      )}
    </Show>
  )
}

// ============================================================================
// LLM Call Tabs Component
// ============================================================================

type LLMTab = 'rawPrompt' | 'parsedPrompt' | 'rawOutput' | 'parsedOutput'

const TabButton = (props: { active: boolean; label: string; onClick: () => void }) => (
  <button
    onClick={props.onClick}
    p="x-3 y-1.5"
    text={`xs ${props.active ? 'neon-cyan' : 'dark-text-secondary hover:dark-text-primary'}`}
    bg={props.active ? 'neon-cyan/10' : 'transparent hover:dark-bg-hover'}
    border={props.active ? '1 neon-cyan/30' : '1 transparent'}
    rounded="md"
    cursor="pointer"
    transition="all"
    font="medium"
  >
    {props.label}
  </button>
)

const UsageStats = (props: { llmCall: LLMCallData }) => (
  <div
    bg="dark-bg-tertiary"
    p="3"
    rounded="md"
    m="b-3"
  >
    <div flex="~ wrap" gap="4" items="center">
      {/* Function & Provider */}
      <div flex="~ col" gap="0.5">
        <span text="xs dark-text-tertiary">Function</span>
        <span text="sm neon-cyan" font="mono">{props.llmCall.functionName}</span>
      </div>
      <Show when={props.llmCall.provider}>
        <div flex="~ col" gap="0.5">
          <span text="xs dark-text-tertiary">Provider</span>
          <span text="sm dark-text-primary" font="mono">{props.llmCall.provider}</span>
        </div>
      </Show>
      <Show when={props.llmCall.clientName}>
        <div flex="~ col" gap="0.5">
          <span text="xs dark-text-tertiary">Client</span>
          <span text="sm dark-text-primary" font="mono">{props.llmCall.clientName}</span>
        </div>
      </Show>

      {/* Separator */}
      <div w="px" h="8" bg="dark-border-secondary" />

      {/* Token stats */}
      <Show when={props.llmCall.usage}>
        <div flex="~ col" gap="0.5">
          <span text="xs dark-text-tertiary">Input</span>
          <span text="sm neon-green" font="mono">{props.llmCall.usage!.inputTokens.toLocaleString()}</span>
        </div>
        <div flex="~ col" gap="0.5">
          <span text="xs dark-text-tertiary">Output</span>
          <span text="sm neon-cyan" font="mono">{props.llmCall.usage!.outputTokens.toLocaleString()}</span>
        </div>
        <Show when={props.llmCall.usage!.cachedInputTokens > 0}>
          <div flex="~ col" gap="0.5">
            <span text="xs dark-text-tertiary">Cached</span>
            <span text="sm violet-400" font="mono">{props.llmCall.usage!.cachedInputTokens.toLocaleString()}</span>
          </div>
        </Show>
        <div flex="~ col" gap="0.5">
          <span text="xs dark-text-tertiary">Total</span>
          <span text="sm amber-400" font="mono">{props.llmCall.usage!.totalTokens.toLocaleString()}</span>
        </div>
      </Show>

      {/* Duration */}
      <Show when={props.llmCall.durationMs}>
        <div flex="~ col" gap="0.5">
          <span text="xs dark-text-tertiary">Duration</span>
          <span text="sm dark-text-primary" font="mono">{props.llmCall.durationMs}ms</span>
        </div>
      </Show>
    </div>
  </div>
)

const LLMCallTabs = (props: { llmCall: LLMCallData }) => {
  const [activeTab, setActiveTab] = createSignal<LLMTab>('rawPrompt')

  return (
    <div border="b dark-border-primary" m="b-4" p="b-4">
      {/* Usage stats bar */}
      <UsageStats llmCall={props.llmCall} />

      {/* Tab buttons */}
      <div flex="~ wrap" gap="2" m="b-3">
        <TabButton
          active={activeTab() === 'rawPrompt'}
          label="Raw Prompt"
          onClick={() => setActiveTab('rawPrompt')}
        />
        <TabButton
          active={activeTab() === 'parsedPrompt'}
          label="Parsed Prompt"
          onClick={() => setActiveTab('parsedPrompt')}
        />
        <TabButton
          active={activeTab() === 'rawOutput'}
          label="Raw Output"
          onClick={() => setActiveTab('rawOutput')}
        />
        <TabButton
          active={activeTab() === 'parsedOutput'}
          label="Parsed Output"
          onClick={() => setActiveTab('parsedOutput')}
        />
      </div>

      {/* Tab content */}
      <Switch>
        <Match when={activeTab() === 'rawPrompt'}>
          <Show
            when={props.llmCall.promptTemplate}
            fallback={
              <div flex="~ col" gap="2">
                <div text="xs dark-text-tertiary" m="b-1">Variables</div>
                <CodeBlock content={JSON.stringify(props.llmCall.variables, null, 2)} />
              </div>
            }
          >
            <CodeBlock content={props.llmCall.promptTemplate} placeholder="Template not captured" />
          </Show>
        </Match>
        <Match when={activeTab() === 'parsedPrompt'}>
          <Show
            when={props.llmCall.rawInput}
            fallback={<CodeBlock content={undefined} placeholder="Parsed prompt not captured" />}
          >
            <ParsedPromptView rawInput={props.llmCall.rawInput!} />
          </Show>
        </Match>
        <Match when={activeTab() === 'rawOutput'}>
          <CodeBlock content={props.llmCall.rawOutput} placeholder="Raw output not captured" />
        </Match>
        <Match when={activeTab() === 'parsedOutput'}>
          <CodeBlock
            content={
              props.llmCall.parsedOutput != null
                ? (typeof props.llmCall.parsedOutput === 'string'
                    ? props.llmCall.parsedOutput
                    : JSON.stringify(props.llmCall.parsedOutput, null, 2))
                : undefined
            }
            placeholder="Parsed output not captured"
          />
        </Match>
      </Switch>
    </div>
  )
}

// ============================================================================
// Event Detail Panel Component
// ============================================================================

const EventDetailPanel = (props: { event: ContextEvent, onClose: () => void }) => {
  const { type, ts, patternId, data, llmCall } = props.event

  return (
    <div
      style={{
        position: 'absolute',
        inset: '0',
        'background-color': 'rgba(13, 17, 23, 0.95)',
        'backdrop-filter': 'blur(4px)',
        'z-index': '50',
        display: 'flex',
        'flex-direction': 'column',
        overflow: 'hidden'
      }}
    >
      {/* Header */}
      <div
        flex="~"
        items="center"
        justify="between"
        p="4"
        border="b dark-border-primary"
      >
        <div flex="~ col" gap="1">
          <div flex="~" items="center" gap="2">
            <span text="lg">{eventIcons[type]}</span>
            <span text="sm dark-text-primary" font="medium">
              {type.replace(/_/g, ' ')}
            </span>
            <Show when={llmCall}>
              <span
                text="xs neon-cyan"
                bg="neon-cyan/10"
                p="x-1.5 y-0.5"
                rounded="sm"
                font="mono"
              >
                LLM
              </span>
            </Show>
          </div>
          <div flex="~" gap="3" text="xs dark-text-tertiary">
            <span>{patternId}</span>
            <span>{new Date(ts).toLocaleTimeString()}</span>
          </div>
        </div>
        <button
          onClick={props.onClose}
          p="2"
          text="dark-text-secondary"
          bg="dark-bg-hover hover:dark-bg-tertiary"
          rounded="md"
          cursor="pointer"
        >
          Close
        </button>
      </div>

      {/* Content */}
      <div flex="1" overflow="auto" p="4">
        {/* LLM Call Tabs - shown when event has llmCall data */}
        <Show when={llmCall}>
          <LLMCallTabs llmCall={llmCall!} />
        </Show>

        {/* Event-specific content — skip for messages with LLM tabs (avoids duplication) */}
        <Show when={!(llmCall && (type === 'assistant_message' || type === 'user_message'))}>
          <Switch fallback={<GenericDetail data={data} />}>
            <Match when={type === 'tool_call'}>
              <ToolCallDetail data={data as ToolCallEventData} />
            </Match>
            <Match when={type === 'tool_result'}>
              <ToolResultDetail data={data as ToolResultEventData} />
            </Match>
            <Match when={type === 'controller_action'}>
              <ActionDetail data={data as ControllerActionEventData} />
            </Match>
            <Match when={type === 'user_message'}>
              <MessageDetail data={data as UserMessageEventData} role="user" />
            </Match>
            <Match when={type === 'assistant_message'}>
              <MessageDetail data={data as AssistantMessageEventData} role="assistant" />
            </Match>
          </Switch>
        </Show>
      </div>
    </div>
  )
}

// ============================================================================
// Main Panel Component
// ============================================================================

export const ObservabilityPanel = (props: ObservabilityPanelProps) => {
  const [expandedIndex, setExpandedIndex] = createSignal<number | null>(null)

  // Sort events chronologically (oldest first)
  const timelineEvents = createMemo(() => {
    return [...props.events].sort((a, b) => a.ts - b.ts)
  })

  // Compute per-event background tint based on active pattern stack
  const eventTints = createMemo(() => {
    const events = timelineEvents()
    const tints: (string | undefined)[] = []
    const patternStack: string[] = []

    for (const event of events) {
      if (event.type === 'pattern_enter') {
        patternStack.push(event.patternId)
        tints.push(undefined) // boundary rows handle their own bg
      } else if (event.type === 'pattern_exit') {
        tints.push(undefined)
        // Pop matching pattern (or last if mismatch)
        const idx = patternStack.lastIndexOf(event.patternId)
        if (idx >= 0) patternStack.splice(idx, 1)
        else patternStack.pop()
      } else {
        // Use the innermost (last) pattern's tint
        const activePattern = patternStack.length > 0
          ? patternStack[patternStack.length - 1]
          : undefined
        tints.push(activePattern ? getPatternColor(activePattern).tint : undefined)
      }
    }
    return tints
  })

  // Get expanded event
  const expandedEvent = createMemo(() => {
    const idx = expandedIndex()
    if (idx === null) return null
    return timelineEvents()[idx] ?? null
  })

  const handleExpand = (index: number) => setExpandedIndex(index)
  const handleClose = () => setExpandedIndex(null)

  const hasEvents = () => timelineEvents().length > 0

  return (
    <div flex="~ col" h="full" bg="dark-bg-primary" overflow="hidden" position="relative">
      {/* Summary Bar */}
      <SummaryBar events={props.events} onClear={props.onClear} />

      {/* Lane Headers */}
      <LaneHeaders />

      {/* Timeline Container */}
      <div flex="1" overflow="auto">
        <Show
          when={hasEvents()}
          fallback={<EmptyState />}
        >
          <For each={timelineEvents()}>
            {(event, index) => {
              const isBoundary = () => event.type === 'pattern_enter' || event.type === 'pattern_exit'
              return (
                <Show
                  when={!isBoundary()}
                  fallback={<PatternBoundaryRow event={event} />}
                >
                  <EventRow
                    event={event}
                    index={index()}
                    expanded={expandedIndex() === index()}
                    onExpand={() => handleExpand(index())}
                    bgTint={eventTints()[index()]}
                  />
                </Show>
              )
            }}
          </For>
        </Show>
      </div>

      {/* Event Detail Panel */}
      <Show when={expandedEvent()}>
        <EventDetailPanel
          event={expandedEvent()!}
          onClose={handleClose}
        />
      </Show>
    </div>
  )
}
