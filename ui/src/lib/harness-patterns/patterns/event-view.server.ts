/**
 * EventView - Server Only
 *
 * Fluent API for filtering and querying events from UnifiedContext.
 * Used by patterns to access events from previous patterns.
 */

import { assertServerOnImport } from '../assert.server'
import type {
  UnifiedContext,
  ContextEvent,
  EventType,
  ViewConfig,
  EventView as IEventView,
  UserMessageEventData,
  AssistantMessageEventData,
  ToolCallEventData,
  ToolResultEventData
} from '../types'

assertServerOnImport()

// ============================================================================
// EventView Implementation
// ============================================================================

type EventFilter = (event: ContextEvent) => boolean

export class EventViewImpl implements IEventView {
  private filters: EventFilter[] = []
  private limitLast?: number
  private limitFirst?: number
  private sinceTs?: number

  constructor(
    private ctx: UnifiedContext,
    config?: ViewConfig
  ) {
    // Apply initial config
    if (config) {
      this.applyConfig(config)
    }
  }

  private applyConfig(config: ViewConfig): void {
    if (config.fromPatterns && config.fromPatterns.length > 0) {
      this.fromPatterns(config.fromPatterns)
    } else if (config.fromLastN !== undefined) {
      this.fromLastNPatterns(config.fromLastN)
    } else if (config.fromLast !== false) {
      // Default to fromLast: true
      this.fromLastPattern()
    }

    if (config.eventTypes && config.eventTypes.length > 0) {
      this.ofTypes(config.eventTypes)
    }

    if (config.limit !== undefined) {
      this.last(config.limit)
    }
  }

  private addFilter(filter: EventFilter): this {
    this.filters.push(filter)
    return this
  }

  private clone(): EventViewImpl {
    const view = new EventViewImpl(this.ctx)
    view.filters = [...this.filters]
    view.limitLast = this.limitLast
    view.limitFirst = this.limitFirst
    view.sinceTs = this.sinceTs
    return view
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Pattern Selectors
  // ─────────────────────────────────────────────────────────────────────────

  /** Events from a specific pattern by ID */
  fromPattern(patternId: string): EventViewImpl {
    const view = this.clone()
    view.addFilter((e) => e.patternId === patternId)
    return view
  }

  /** Events from multiple specific patterns */
  fromPatterns(patternIds: string[]): EventViewImpl {
    const view = this.clone()
    const idSet = new Set(patternIds)
    view.addFilter((e) => idSet.has(e.patternId))
    return view
  }

  /** Events from the immediately preceding pattern */
  fromLastPattern(): EventViewImpl {
    const lastPatternId = this.getLastPatternId()
    if (!lastPatternId) {
      // Return empty view if no previous pattern
      const view = this.clone()
      view.addFilter(() => false)
      return view
    }
    return this.fromPattern(lastPatternId)
  }

  /** Events from the last N patterns in execution order */
  fromLastNPatterns(n: number): EventViewImpl {
    const patternIds = this.getPatternIds().slice(-n)
    if (patternIds.length === 0) {
      const view = this.clone()
      view.addFilter(() => false)
      return view
    }
    return this.fromPatterns(patternIds)
  }

  /** Events from all patterns (no pattern filter) */
  fromAll(): EventViewImpl {
    return this.clone()
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Type Selectors
  // ─────────────────────────────────────────────────────────────────────────

  /** Events of a specific type */
  ofType(type: EventType): EventViewImpl {
    const view = this.clone()
    view.addFilter((e) => e.type === type)
    return view
  }

  /** Events of multiple types */
  ofTypes(types: EventType[]): EventViewImpl {
    const view = this.clone()
    const typeSet = new Set(types)
    view.addFilter((e) => typeSet.has(e.type))
    return view
  }

  /** Tool-related events (tool_call + tool_result) */
  tools(): EventViewImpl {
    return this.ofTypes(['tool_call', 'tool_result'])
  }

  /** Message events (user_message + assistant_message) */
  messages(): EventViewImpl {
    return this.ofTypes(['user_message', 'assistant_message'])
  }

  /** Controller action events */
  actions(): EventViewImpl {
    return this.ofType('controller_action')
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Quantity Selectors
  // ─────────────────────────────────────────────────────────────────────────

  /** Last N events (after other filters applied) */
  last(n: number): EventViewImpl {
    const view = this.clone()
    view.limitLast = n
    return view
  }

  /** First N events (after other filters applied) */
  first(n: number): EventViewImpl {
    const view = this.clone()
    view.limitFirst = n
    return view
  }

  /** Events since a specific timestamp */
  since(ts: number): EventViewImpl {
    const view = this.clone()
    view.sinceTs = ts
    return view
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Execution
  // ─────────────────────────────────────────────────────────────────────────

  /** Execute query and return events */
  get(): ContextEvent[] {
    let events = this.ctx.events

    // Apply timestamp filter first
    if (this.sinceTs !== undefined) {
      events = events.filter((e) => e.ts >= this.sinceTs!)
    }

    // Apply all filters
    for (const filter of this.filters) {
      events = events.filter(filter)
    }

    // Apply limits
    if (this.limitFirst !== undefined) {
      events = events.slice(0, this.limitFirst)
    }
    if (this.limitLast !== undefined) {
      events = events.slice(-this.limitLast)
    }

    return events
  }

  /** Serialize events to XML format for LLM context */
  serialize(): string {
    return this.get()
      .map((event) => formatEvent(event))
      .join('\n')
  }

  /** Check if any events match */
  exists(): boolean {
    return this.get().length > 0
  }

  /** Count matching events */
  count(): number {
    return this.get().length
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internal Helpers
  // ─────────────────────────────────────────────────────────────────────────

  /** Get unique pattern IDs in order of first pattern_enter */
  private getPatternIds(): string[] {
    const seen = new Set<string>()
    return this.ctx.events
      .filter((e) => e.type === 'pattern_enter')
      .map((e) => e.patternId)
      .filter((id) => {
        if (seen.has(id)) return false
        seen.add(id)
        return true
      })
  }

  /** Get the ID of the last pattern that entered */
  private getLastPatternId(): string | undefined {
    const ids = this.getPatternIds()
    return ids.at(-1)
  }
}

// ============================================================================
// Event Formatting
// ============================================================================

/** Format a single event as XML for LLM context */
function formatEvent(event: ContextEvent): string {
  const content = formatEventData(event)
  return `<${event.type}>${content}</${event.type}>`
}

/** Format event data based on type */
function formatEventData(event: ContextEvent): string {
  switch (event.type) {
    case 'user_message': {
      const data = event.data as UserMessageEventData
      return data.content
    }
    case 'assistant_message': {
      const data = event.data as AssistantMessageEventData
      return data.content
    }
    case 'tool_call': {
      const data = event.data as ToolCallEventData
      return `${data.tool}: ${JSON.stringify(data.args)}`
    }
    case 'tool_result': {
      const data = event.data as ToolResultEventData
      if (!data.success) {
        return `${data.tool} ERROR: ${data.error}`
      }
      return `${data.tool}: ${JSON.stringify(data.result)}`
    }
    default:
      return typeof event.data === 'object'
        ? JSON.stringify(event.data)
        : String(event.data)
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/** Create a new EventView for querying context events */
export function createEventView(
  ctx: UnifiedContext,
  config?: ViewConfig
): EventViewImpl {
  return new EventViewImpl(ctx, config)
}
