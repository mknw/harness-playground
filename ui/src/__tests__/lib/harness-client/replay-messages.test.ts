/**
 * replayMessages — chat-history hydration filter.
 *
 * Verifies that on conversation restore (sidebar selection), intermediate
 * router status messages ("Let me look into that…") are excluded and only
 * the synthesizer's (or direct-response router's) final emit surfaces as a
 * chat bubble. Discriminator: `AssistantMessageEventData.final === true`.
 */
import { describe, it, expect } from 'vitest'
import { replayMessages } from '../../../lib/harness-client/replay'
import type { ContextEvent } from '../../../lib/harness-patterns'

const userMsg = (content: string, ts: number, id: string): ContextEvent => ({
  id,
  type: 'user_message',
  ts,
  patternId: 'harness',
  data: { content },
})

const assistantMsg = (content: string, ts: number, id: string, opts?: { final?: boolean; patternId?: string }): ContextEvent => ({
  id,
  type: 'assistant_message',
  ts,
  patternId: opts?.patternId ?? 'router',
  data: { content, ...(opts?.final !== undefined ? { final: opts.final } : {}) },
})

const wrap = (events: ContextEvent[]) => JSON.stringify({ events })

describe('replayMessages', () => {
  it('returns [] for non-JSON input', () => {
    expect(replayMessages('not json')).toEqual([])
  })

  it('returns [] when context has no events', () => {
    expect(replayMessages(JSON.stringify({ events: [] }))).toEqual([])
    expect(replayMessages(JSON.stringify({}))).toEqual([])
  })

  it('keeps all user messages', () => {
    const out = replayMessages(wrap([
      userMsg('first', 1, 'u1'),
      userMsg('second', 2, 'u2'),
    ]))
    expect(out.map(m => m.content)).toEqual(['first', 'second'])
    expect(out.every(m => m.role === 'user')).toBe(true)
  })

  it('skips assistant_message events without final: true (router status)', () => {
    const out = replayMessages(wrap([
      userMsg('hi', 1, 'u1'),
      assistantMsg('Let me look into that…', 2, 'a1', { patternId: 'router' }),
      assistantMsg('Looking into the graph…', 3, 'a2', { patternId: 'router' }),
    ]))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ role: 'user', content: 'hi' })
  })

  it('keeps assistant_message events with final: true (synthesizer output)', () => {
    const out = replayMessages(wrap([
      userMsg('hi', 1, 'u1'),
      assistantMsg('Looking…', 2, 'a1', { patternId: 'router' }),                          // intermediate, skipped
      assistantMsg('Here is the answer.', 3, 'a2', { final: true, patternId: 'response-synth' }),  // final, kept
    ]))
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ role: 'user', content: 'hi' })
    expect(out[1]).toMatchObject({ role: 'assistant', content: 'Here is the answer.' })
  })

  it('handles a multi-turn conversation with mixed router + synthesizer emits', () => {
    const out = replayMessages(wrap([
      userMsg('q1', 1, 'u1'),
      assistantMsg('Routing…', 2, 'r1', { patternId: 'router' }),
      assistantMsg('A1.', 3, 's1', { final: true, patternId: 'response-synth' }),
      userMsg('q2', 4, 'u2'),
      assistantMsg('Routing…', 5, 'r2', { patternId: 'router' }),
      assistantMsg('A2.', 6, 's2', { final: true, patternId: 'response-synth' }),
    ]))
    expect(out.map(m => ({ role: m.role, content: m.content }))).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'A1.' },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'A2.' },
    ])
  })

  it('keeps the router-as-final emit on a conversational direct-response turn', () => {
    // When the router decides no tool is needed, it emits the final response
    // itself (final: true) and the synthesizer skips BAML for that route.
    const out = replayMessages(wrap([
      userMsg('what time is it?', 1, 'u1'),
      assistantMsg("I don't have realtime access.", 2, 'r1', { final: true, patternId: 'router' }),
    ]))
    expect(out).toHaveLength(2)
    expect(out[1]).toMatchObject({ role: 'assistant', content: "I don't have realtime access." })
  })

  it('preserves event ordering by array position', () => {
    const out = replayMessages(wrap([
      userMsg('q1', 1, 'u1'),
      assistantMsg('A1.', 3, 's1', { final: true }),
      userMsg('q2', 2, 'u2'), // intentionally out-of-order ts to confirm we keep array order
    ]))
    expect(out.map(m => m.timestamp)).toEqual([1, 3, 2])
  })

  it('falls back to a synthetic id when an event lacks one', () => {
    const out = replayMessages(wrap([
      { ...userMsg('hi', 1, ''), id: undefined } as ContextEvent,
    ]))
    expect(out[0].id).toMatch(/^replay-\d+$/)
  })
})
