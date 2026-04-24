/**
 * EventStore
 *
 * Reactive store for ContextEvents to replace TelemetryStore.
 * Uses Solid.js store primitives for reactivity.
 */

import { createStore, produce } from 'solid-js/store'
import type { ContextEvent } from '../harness-patterns'

interface EventStoreState {
  events: ContextEvent[]
  expandedEventIndex: number | null
}

export interface EventStore {
  state: EventStoreState
  addEvents: (events: ContextEvent[]) => void
  clearEvents: () => void
  expandEvent: (index: number) => void
  collapseEvent: () => void
}

export function createEventStore(): EventStore {
  const [state, setState] = createStore<EventStoreState>({
    events: [],
    expandedEventIndex: null
  })

  return {
    state,
    addEvents: (events) => setState(produce(s => { s.events.push(...events) })),
    clearEvents: () => setState({ events: [], expandedEventIndex: null }),
    expandEvent: (index) => setState({ expandedEventIndex: index }),
    collapseEvent: () => setState({ expandedEventIndex: null })
  }
}
