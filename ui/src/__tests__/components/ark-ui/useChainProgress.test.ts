/**
 * useChainProgress tests
 *
 * Verifies the chain-progress derivation matches the user-facing spec for the
 * default agent: router (1) + simpleLoop maxTurns=5 (5) + synth (1) = 7.
 */

import { describe, it, expect } from 'vitest'
import { createRoot } from 'solid-js'
import { createChainProgress } from '../../../components/ark-ui/useChainProgress'
import type { ContextEvent } from '~/lib/harness-patterns'

const ev = (type: ContextEvent['type'], patternId: string, data: unknown = {}, id?: string): ContextEvent => ({
  id: id ?? `ev-${Math.random().toString(36).slice(2, 7)}`,
  type,
  ts: Date.now(),
  patternId,
  data,
})

describe('createChainProgress', () => {
  it('starts empty', () => {
    createRoot(() => {
      const p = createChainProgress()
      expect(p.snapshot()).toEqual({ currentTurn: 0, totalTurns: 0, status: null, done: false })
    })
  })

  it('default-agent stream → 7/7 with the expected status sequence', () => {
    createRoot(() => {
      const p = createChainProgress()

      // 1) router
      p.ingest(ev('pattern_enter', 'router', { pattern: 'router' }))
      p.ingest(ev('assistant_message', 'router', { content: 'Routing to neo4j…' }))
      // pattern_enter for router contributes 1; advance fires on assistant_message
      expect(p.snapshot().totalTurns).toBe(1)
      expect(p.snapshot().currentTurn).toBe(1)
      expect(p.snapshot().status).toBe('Routing to neo4j…')
      p.ingest(ev('pattern_exit', 'router'))

      // 2) routes wraps neo4j-query — wrapper enter is discarded by the next enter
      p.ingest(ev('pattern_enter', 'routes', { pattern: 'routes(neo4j|web|code)' }))
      p.ingest(ev('pattern_enter', 'neo4j-query', { pattern: 'simpleLoop', maxTurns: 5 }))

      // First controller_action: total flushes (+5 from simpleLoop only), current advances to 2
      p.ingest(
        ev('controller_action', 'neo4j-query', {
          action: { reasoning: 'r', status: 'Querying schema', tool_name: 'get_neo4j_schema', tool_args: '{}', is_final: false }
        })
      )
      expect(p.snapshot().totalTurns).toBe(6) // 1 (router) + 5 (simpleLoop). routes was discarded.
      expect(p.snapshot().currentTurn).toBe(2)
      expect(p.snapshot().status).toBe('Querying schema')

      // Remaining 4 controller_actions
      for (let i = 2; i <= 5; i++) {
        p.ingest(
          ev('controller_action', 'neo4j-query', {
            action: { reasoning: 'r', status: `Step ${i}`, tool_name: 't', tool_args: '{}', is_final: i === 5 }
          })
        )
      }
      expect(p.snapshot().currentTurn).toBe(6)
      expect(p.snapshot().status).toBe('Step 5')

      p.ingest(ev('pattern_exit', 'neo4j-query'))
      p.ingest(ev('pattern_exit', 'routes'))

      // 3) synthesizer
      p.ingest(ev('pattern_enter', 'response-synth', { pattern: 'synthesizer' }))
      p.ingest(ev('assistant_message', 'response-synth', { content: 'Done — here is your answer.' }))
      expect(p.snapshot().totalTurns).toBe(7)
      expect(p.snapshot().currentTurn).toBe(7)
      expect(p.snapshot().status).toBe('Done — here is your answer.')

      p.ingest(ev('pattern_exit', 'response-synth'))
      p.finish()
      expect(p.snapshot().done).toBe(true)
    })
  })

  it('discards a wrapper pattern_enter when followed by another pattern_enter', () => {
    createRoot(() => {
      const p = createChainProgress()
      p.ingest(ev('pattern_enter', 'wrapper', { pattern: 'withApproval' }))
      p.ingest(ev('pattern_enter', 'inner', { pattern: 'simpleLoop', maxTurns: 3 }))
      p.ingest(ev('controller_action', 'inner', { action: { status: 's' } }))
      // Only the inner pattern's 3 contributes — wrapper was discarded
      expect(p.snapshot().totalTurns).toBe(3)
      expect(p.snapshot().currentTurn).toBe(1)
    })
  })

  it('counts a leaf pattern_enter even if it has no maxTurns (contributes 1)', () => {
    createRoot(() => {
      const p = createChainProgress()
      p.ingest(ev('pattern_enter', 'leaf', { pattern: 'router' }))
      p.ingest(ev('assistant_message', 'leaf', { content: 'hello' }))
      expect(p.snapshot().totalTurns).toBe(1)
      expect(p.snapshot().currentTurn).toBe(1)
    })
  })

  it('truncates long status strings to a single line', () => {
    createRoot(() => {
      const p = createChainProgress()
      p.ingest(ev('pattern_enter', 'leaf', { pattern: 'router' }))
      p.ingest(
        ev('assistant_message', 'leaf', {
          content: 'first line that should be displayed\nsecond line that must be hidden'
        })
      )
      expect(p.snapshot().status).toBe('first line that should be displayed')
    })
  })

  it('does not double-advance when multiple assistant_messages share the same patternId', () => {
    createRoot(() => {
      const p = createChainProgress()
      p.ingest(ev('pattern_enter', 'router', { pattern: 'router' }))
      p.ingest(ev('assistant_message', 'router', { content: 'first' }))
      p.ingest(ev('assistant_message', 'router', { content: 'second' }))
      expect(p.snapshot().totalTurns).toBe(1)
      expect(p.snapshot().currentTurn).toBe(1)
      expect(p.snapshot().status).toBe('second')
    })
  })

  it('reset clears all state', () => {
    createRoot(() => {
      const p = createChainProgress()
      p.ingest(ev('pattern_enter', 'router', { pattern: 'router' }))
      p.ingest(ev('assistant_message', 'router', { content: 'hi' }))
      expect(p.snapshot().currentTurn).toBe(1)
      p.reset()
      expect(p.snapshot()).toEqual({ currentTurn: 0, totalTurns: 0, status: null, done: false })
    })
  })
})
