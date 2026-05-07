/**
 * synthesizer Pattern Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock server-only imports
vi.mock('../../../../lib/harness-patterns/assert.server', () => ({
  assertServerOnImport: vi.fn()
}))

// Mock BAML client
vi.mock('../../../../../baml_client', () => ({
  b: {
    Synthesize: vi.fn(async () => 'Synthesized response from BAML')
  }
}))

// Mock Collector — must be a real class so `new Collector()` works
vi.mock('@boundaryml/baml', () => {
  class MockCollector {
    last = {
      rawLlmResponse: 'Raw response',
      usage: { inputTokens: 100, outputTokens: 50 },
      calls: [{ httpRequest: { body: { messages: [] } } }]
    }
    constructor(_name?: string) {}
  }
  return { Collector: MockCollector }
})

describe('synthesizer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should export synthesizer function', async () => {
    const { synthesizer } = await import('../../../../lib/harness-patterns/patterns/synthesizer.server')
    expect(synthesizer).toBeDefined()
    expect(typeof synthesizer).toBe('function')
  })

  it('should create a ConfiguredPattern with name and config', async () => {
    const { synthesizer } = await import('../../../../lib/harness-patterns/patterns/synthesizer.server')

    const pattern = synthesizer({
      mode: 'message',
      patternId: 'test-synthesizer'
    })

    expect(pattern.name).toBe('synthesizer')
    expect(pattern.config.patternId).toBe('test-synthesizer')
    expect(pattern.fn).toBeDefined()
  })

  describe('modes', () => {
    it('should support message mode', async () => {
      const { synthesizer } = await import('../../../../lib/harness-patterns/patterns/synthesizer.server')

      const pattern = synthesizer({ mode: 'message' })
      expect(pattern.name).toBe('synthesizer')
    })

    it('should support response mode', async () => {
      const { synthesizer } = await import('../../../../lib/harness-patterns/patterns/synthesizer.server')

      const pattern = synthesizer({ mode: 'response' })
      expect(pattern.name).toBe('synthesizer')
    })

    it('should support thread mode', async () => {
      const { synthesizer } = await import('../../../../lib/harness-patterns/patterns/synthesizer.server')

      const pattern = synthesizer({ mode: 'thread' })
      expect(pattern.name).toBe('synthesizer')
    })
  })

  describe('custom synthesis function', () => {
    it('should use custom synthesis function when provided', async () => {
      const { synthesizer } = await import('../../../../lib/harness-patterns/patterns/synthesizer.server')
      const { createScope } = await import('../../../../lib/harness-patterns/context.server')
      const { createEventView } = await import('../../../../lib/harness-patterns/patterns')

      const customSynthesize = vi.fn(async () => 'Custom synthesized response')

      const pattern = synthesizer({
        mode: 'message',
        synthesize: customSynthesize
      })

      const scope = createScope('test', { response: 'original response' })
      const mockContext = {
        sessionId: 'test',
        createdAt: Date.now(),
        events: [
          { type: 'user_message' as const, ts: Date.now(), patternId: 'harness', data: { content: 'test query' } }
        ],
        status: 'running' as const,
        data: {},
        input: 'test query'
      }
      const view = createEventView(mockContext)

      const result = await pattern.fn(scope, view)

      expect(customSynthesize).toHaveBeenCalled()
      expect(result.data.synthesizedResponse).toBe('Custom synthesized response')
    })
  })

  describe('skipIfHasResponse', () => {
    it('should skip synthesis if response exists and skipIfHasResponse is true', async () => {
      const { synthesizer } = await import('../../../../lib/harness-patterns/patterns/synthesizer.server')
      const { createScope } = await import('../../../../lib/harness-patterns/context.server')
      const { createEventView } = await import('../../../../lib/harness-patterns/patterns')

      const customSynthesize = vi.fn(async () => 'New response')

      const pattern = synthesizer({
        mode: 'message',
        synthesize: customSynthesize,
        skipIfHasResponse: true
      })

      const scope = createScope('test', { synthesizedResponse: 'existing response' })
      const mockContext = {
        sessionId: 'test',
        createdAt: Date.now(),
        events: [],
        status: 'running' as const,
        data: {},
        input: 'test'
      }
      const view = createEventView(mockContext)

      const result = await pattern.fn(scope, view)

      expect(customSynthesize).not.toHaveBeenCalled()
      expect(result.data.synthesizedResponse).toBe('existing response')
    })
  })
})

describe('synthesizer execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should track assistant_message event', async () => {
    const { synthesizer } = await import('../../../../lib/harness-patterns/patterns/synthesizer.server')
    const { createScope } = await import('../../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../../lib/harness-patterns/patterns')

    const pattern = synthesizer({
      mode: 'message',
      trackHistory: 'assistant_message',
      synthesize: async () => 'Test response'
    })

    const scope = createScope('test', {})
    const mockContext = {
      sessionId: 'test',
      createdAt: Date.now(),
      events: [
        { type: 'user_message' as const, ts: Date.now(), patternId: 'harness', data: { content: 'test' } }
      ],
      status: 'running' as const,
      data: {},
      input: 'test'
    }
    const view = createEventView(mockContext)

    const result = await pattern.fn(scope, view)

    expect(result.events).toHaveLength(1)
    expect(result.events[0].type).toBe('assistant_message')
    expect((result.events[0].data as { content: string }).content).toBe('Test response')
  })

  it('should call default synthesis with BAML when no custom function provided', async () => {
    const { synthesizer } = await import('../../../../lib/harness-patterns/patterns/synthesizer.server')
    const { createScope } = await import('../../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../../lib/harness-patterns/patterns')

    // No custom synthesize function — should use defaultSynthesize → b.Synthesize mock
    const pattern = synthesizer({
      mode: 'message',
      trackHistory: true
    })

    const scope = createScope('test', {})
    const mockContext = {
      sessionId: 'test',
      createdAt: Date.now(),
      events: [
        { type: 'user_message' as const, ts: Date.now(), patternId: 'harness', data: { content: 'test query' } }
      ],
      status: 'running' as const,
      data: {},
      input: 'test query'
    }
    const view = createEventView(mockContext)

    const result = await pattern.fn(scope, view)

    // Should have used the BAML mock's return value
    expect(result.data.synthesizedResponse).toBe('Synthesized response from BAML')
    expect(result.events.filter(e => e.type === 'assistant_message')).toHaveLength(1)
  })

  it('should handle response mode', async () => {
    const { synthesizer } = await import('../../../../lib/harness-patterns/patterns/synthesizer.server')
    const { createScope } = await import('../../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../../lib/harness-patterns/patterns')

    const pattern = synthesizer({
      mode: 'response',
      synthesize: async (input) => `Response mode: ${input.response}`
    })

    const scope = createScope('test', { response: 'my data' })
    const mockContext = {
      sessionId: 'test',
      createdAt: Date.now(),
      events: [
        { type: 'user_message' as const, ts: Date.now(), patternId: 'harness', data: { content: 'test' } }
      ],
      status: 'running' as const,
      data: {},
      input: 'test'
    }
    const view = createEventView(mockContext)

    const result = await pattern.fn(scope, view)

    expect(result.data.synthesizedResponse).toBe('Response mode: my data')
  })

  it('should handle thread mode with loop history from events', async () => {
    const { synthesizer } = await import('../../../../lib/harness-patterns/patterns/synthesizer.server')
    const { createScope } = await import('../../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../../lib/harness-patterns/patterns')

    const pattern = synthesizer({
      mode: 'thread',
      synthesize: async (input) => `Thread mode with ${input.loopHistory?.iterations.length ?? 0} iterations`
    })

    const scope = createScope('test', {})
    // Put controller_action and tool_result events into context so synthesizer
    // can reconstruct loop history from the event stream (not data.loopHistory)
    const now = Date.now()
    const mockContext = {
      sessionId: 'test',
      createdAt: now,
      events: [
        { type: 'user_message' as const, ts: now, patternId: 'harness', data: { content: 'test' } },
        { type: 'pattern_enter' as const, ts: now, patternId: 'web-search', data: { pattern: 'simpleLoop' } },
        { type: 'controller_action' as const, ts: now + 1, patternId: 'web-search', data: {
          action: { tool_name: 'search', tool_args: '{"q":"test"}', reasoning: 'Search for results', status: 'success', is_final: false }
        }},
        { type: 'tool_result' as const, ts: now + 2, patternId: 'web-search', data: {
          tool: 'search', result: { items: [] }, success: true
        }},
        { type: 'pattern_exit' as const, ts: now + 3, patternId: 'web-search', data: { status: 'completed' } },
      ],
      status: 'running' as const,
      data: {},
      input: 'test'
    }
    const view = createEventView(mockContext)

    const result = await pattern.fn(scope, view)

    expect(result.data.synthesizedResponse).toBe('Thread mode with 1 iterations')
  })

  it('should handle thread mode falling back to response mode when no history', async () => {
    const { synthesizer } = await import('../../../../lib/harness-patterns/patterns/synthesizer.server')
    const { createScope } = await import('../../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../../lib/harness-patterns/patterns')

    const pattern = synthesizer({
      mode: 'thread',
      synthesize: async (input) => `Mode: ${input.mode}, Response: ${input.response}`
    })

    const scope = createScope('test', { response: 'fallback response' })
    const mockContext = {
      sessionId: 'test',
      createdAt: Date.now(),
      events: [
        { type: 'user_message' as const, ts: Date.now(), patternId: 'harness', data: { content: 'test' } }
      ],
      status: 'running' as const,
      data: {},
      input: 'test'
    }
    const view = createEventView(mockContext)

    const result = await pattern.fn(scope, view)

    // Should fall back to response mode
    expect(result.data.synthesizedResponse).toContain('response')
  })

  it('should handle errors gracefully', async () => {
    const { synthesizer } = await import('../../../../lib/harness-patterns/patterns/synthesizer.server')
    const { createScope } = await import('../../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../../lib/harness-patterns/patterns')

    const pattern = synthesizer({
      mode: 'message',
      synthesize: async () => {
        throw new Error('Synthesis failed')
      }
    })

    const scope = createScope('test', {})
    const mockContext = {
      sessionId: 'test',
      createdAt: Date.now(),
      events: [
        { type: 'user_message' as const, ts: Date.now(), patternId: 'harness', data: { content: 'test' } }
      ],
      status: 'running' as const,
      data: {},
      input: 'test'
    }
    const view = createEventView(mockContext)

    const result = await pattern.fn(scope, view)

    const errorEvents = result.events.filter(e => e.type === 'error')
    expect(errorEvents.length).toBeGreaterThan(0)
    expect(JSON.stringify(errorEvents[0].data)).toContain('Synthesis failed')
  })

  it('should build input from events for thread mode', async () => {
    const { synthesizer } = await import('../../../../lib/harness-patterns/patterns/synthesizer.server')
    const { createScope } = await import('../../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../../lib/harness-patterns/patterns')

    const pattern = synthesizer({
      mode: 'thread',
      synthesize: async (input) => `Iterations: ${input.loopHistory?.iterations.length ?? 0}`
    })

    const scope = createScope('test', {})
    const ts = Date.now()
    const mockContext = {
      sessionId: 'test',
      createdAt: ts,
      events: [
        { type: 'user_message' as const, ts, patternId: 'harness', data: { content: 'test' } },
        { type: 'pattern_enter' as const, ts: ts + 1, patternId: 'loop', data: {} },
        { type: 'controller_action' as const, ts: ts + 2, patternId: 'loop', data: { action: { tool_name: 'search', tool_args: '{}', reasoning: 'test', status: '', is_final: false } } },
        { type: 'tool_result' as const, ts: ts + 3, patternId: 'loop', data: { result: { items: ['a', 'b'] } } }
      ],
      status: 'running' as const,
      data: {},
      input: 'test'
    }
    const view = createEventView(mockContext)

    const result = await pattern.fn(scope, view)

    // Should have built loop history from events
    expect(result.data.synthesizedResponse).toContain('Iterations')
  })
})

// ============================================================================
// Issue #45 — synthesizer must read real success/error from tool_result events
// Issue #37 — Return.tool_args must surface as the iteration result, and stale
//              "loop exhausted" errors must be ignored on a clean exit
// ============================================================================

describe('synthesizer truthfulness (issues #45, #37)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('propagates real success=false from tool_result events into the LoopTurn (no hardcoded success)', async () => {
    const { synthesizer } = await import('../../../../lib/harness-patterns/patterns/synthesizer.server')
    const { createScope } = await import('../../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../../lib/harness-patterns/patterns')

    let captured: import('../../../../lib/harness-patterns/types').SynthesizerInput | null = null
    const pattern = synthesizer({
      mode: 'thread',
      synthesize: async (input) => {
        captured = input
        return 'ok'
      },
    })

    const scope = createScope('s', {})
    const ts = Date.now()
    const view = createEventView({
      sessionId: 's', createdAt: ts,
      events: [
        { type: 'user_message' as const, ts, patternId: 'harness', data: { content: 'q' } },
        { type: 'pattern_enter' as const, ts: ts + 1, patternId: 'loop', data: {} },
        { type: 'controller_action' as const, ts: ts + 2, patternId: 'loop', data: {
          action: { tool_name: 'write', tool_args: '{}', reasoning: 'r', status: '', is_final: false }
        }},
        { type: 'tool_result' as const, ts: ts + 3, patternId: 'loop', data: {
          tool: 'write', result: { partial: true }, success: false, error: 'cypher syntax'
        }},
        { type: 'pattern_exit' as const, ts: ts + 4, patternId: 'loop', data: { status: 'completed' } },
      ],
      status: 'running' as const, data: {}, input: 'q',
    })

    await pattern.fn(scope, view)
    expect(captured).not.toBeNull()
    const iterations = captured!.loopHistory?.iterations ?? []
    expect(iterations).toHaveLength(1)
    expect(iterations[0].success).toBe(false)
    expect(iterations[0].error).toBe('cypher syntax')
  })

  it('surfaces Return.tool_args as the iteration result with success=true', async () => {
    const { synthesizer } = await import('../../../../lib/harness-patterns/patterns/synthesizer.server')
    const { createScope } = await import('../../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../../lib/harness-patterns/patterns')

    let captured: import('../../../../lib/harness-patterns/types').SynthesizerInput | null = null
    const pattern = synthesizer({
      mode: 'thread',
      synthesize: async (input) => {
        captured = input
        return 'ok'
      },
    })

    const scope = createScope('s', {})
    const ts = Date.now()
    const returnArgs = JSON.stringify({ answer: 'sorted: A, B, C' })
    const view = createEventView({
      sessionId: 's', createdAt: ts,
      events: [
        { type: 'user_message' as const, ts, patternId: 'harness', data: { content: 'rank them' } },
        { type: 'pattern_enter' as const, ts: ts + 1, patternId: 'loop', data: {} },
        // First a real tool turn, then a Return — the Return action's tool_args carry the answer.
        { type: 'controller_action' as const, ts: ts + 2, patternId: 'loop', data: {
          action: { tool_name: 'read', tool_args: '{}', reasoning: 'fetch', status: '', is_final: false }
        }},
        { type: 'tool_result' as const, ts: ts + 3, patternId: 'loop', data: {
          tool: 'read', result: ['a', 'b'], success: true
        }},
        { type: 'controller_action' as const, ts: ts + 4, patternId: 'loop', data: {
          action: { tool_name: 'Return', tool_args: returnArgs, reasoning: 'have answer', status: '', is_final: true }
        }},
        { type: 'pattern_exit' as const, ts: ts + 5, patternId: 'loop', data: { status: 'completed' } },
      ],
      status: 'running' as const, data: {}, input: 'rank them',
    })

    await pattern.fn(scope, view)
    const iterations = captured!.loopHistory?.iterations ?? []
    expect(iterations).toHaveLength(2)
    const last = iterations[iterations.length - 1]
    expect(last.action.tool_name).toBe('Return')
    expect(last.success).toBe(true)
    expect(last.result).toEqual({ answer: 'sorted: A, B, C' })
  })

  it('ignores stale "Loop exhausted" error when the last action exited via Return', async () => {
    const { synthesizer } = await import('../../../../lib/harness-patterns/patterns/synthesizer.server')
    const { createScope } = await import('../../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../../lib/harness-patterns/patterns')

    let captured: import('../../../../lib/harness-patterns/types').SynthesizerInput | null = null
    const pattern = synthesizer({
      mode: 'thread',
      synthesize: async (input) => {
        captured = input
        return 'ok'
      },
    })

    const scope = createScope('s', {})
    const ts = Date.now()
    const view = createEventView({
      sessionId: 's', createdAt: ts,
      events: [
        { type: 'user_message' as const, ts, patternId: 'harness', data: { content: 'q' } },
        { type: 'pattern_enter' as const, ts: ts + 1, patternId: 'loop', data: {} },
        { type: 'controller_action' as const, ts: ts + 2, patternId: 'loop', data: {
          action: { tool_name: 'read', tool_args: '{}', reasoning: 'r', status: '', is_final: false }
        }},
        { type: 'tool_result' as const, ts: ts + 3, patternId: 'loop', data: {
          tool: 'read', result: { ok: true }, success: true
        }},
        // Stale recoverable error from earlier exhaustion-style warning.
        { type: 'error' as const, ts: ts + 4, patternId: 'loop', data: {
          error: 'Loop exhausted: reached maxTurns (5) without Return', severity: 'recoverable'
        }},
        // Controller eventually issued a clean Return with the answer baked in.
        { type: 'controller_action' as const, ts: ts + 5, patternId: 'loop', data: {
          action: { tool_name: 'Return', tool_args: '{"answer":"all good"}', reasoning: 'done', status: '', is_final: true }
        }},
        { type: 'pattern_exit' as const, ts: ts + 6, patternId: 'loop', data: { status: 'completed' } },
      ],
      status: 'running' as const, data: {}, input: 'q',
    })

    await pattern.fn(scope, view)
    expect(captured!.hasError).toBe(false)
    expect(captured!.errorMessage).toBeUndefined()
  })

  it('still surfaces errors when the loop did not exit cleanly', async () => {
    const { synthesizer } = await import('../../../../lib/harness-patterns/patterns/synthesizer.server')
    const { createScope } = await import('../../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../../lib/harness-patterns/patterns')

    let captured: import('../../../../lib/harness-patterns/types').SynthesizerInput | null = null
    const pattern = synthesizer({
      mode: 'thread',
      synthesize: async (input) => {
        captured = input
        return 'ok'
      },
    })

    const scope = createScope('s', {})
    const ts = Date.now()
    const view = createEventView({
      sessionId: 's', createdAt: ts,
      events: [
        { type: 'user_message' as const, ts, patternId: 'harness', data: { content: 'q' } },
        { type: 'pattern_enter' as const, ts: ts + 1, patternId: 'loop', data: {} },
        { type: 'controller_action' as const, ts: ts + 2, patternId: 'loop', data: {
          action: { tool_name: 'read', tool_args: '{}', reasoning: 'r', status: '', is_final: false }
        }},
        { type: 'error' as const, ts: ts + 3, patternId: 'loop', data: {
          error: 'Loop exhausted: reached maxTurns', severity: 'recoverable'
        }},
        { type: 'pattern_exit' as const, ts: ts + 4, patternId: 'loop', data: { status: 'failed' } },
      ],
      status: 'running' as const, data: {}, input: 'q',
    })

    await pattern.fn(scope, view)
    expect(captured!.hasError).toBe(true)
    expect(captured!.errorMessage).toContain('Loop exhausted')
  })

  it('treats is_final on a real tool as a clean exit only when the tool succeeded', async () => {
    const { synthesizer } = await import('../../../../lib/harness-patterns/patterns/synthesizer.server')
    const { createScope } = await import('../../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../../lib/harness-patterns/patterns')

    let captured: import('../../../../lib/harness-patterns/types').SynthesizerInput | null = null
    const pattern = synthesizer({
      mode: 'thread',
      synthesize: async (input) => {
        captured = input
        return 'ok'
      },
    })

    const scope = createScope('s', {})
    const ts = Date.now()
    // is_final + failed tool → not a clean exit, surface the error.
    const view = createEventView({
      sessionId: 's', createdAt: ts,
      events: [
        { type: 'user_message' as const, ts, patternId: 'harness', data: { content: 'q' } },
        { type: 'pattern_enter' as const, ts: ts + 1, patternId: 'loop', data: {} },
        { type: 'controller_action' as const, ts: ts + 2, patternId: 'loop', data: {
          action: { tool_name: 'write', tool_args: '{}', reasoning: 'r', status: '', is_final: true }
        }},
        { type: 'tool_result' as const, ts: ts + 3, patternId: 'loop', data: {
          tool: 'write', result: null, success: false, error: 'syntax error'
        }},
        { type: 'error' as const, ts: ts + 4, patternId: 'loop', data: {
          error: 'syntax error', severity: 'recoverable'
        }},
        { type: 'pattern_exit' as const, ts: ts + 5, patternId: 'loop', data: { status: 'failed' } },
      ],
      status: 'running' as const, data: {}, input: 'q',
    })

    await pattern.fn(scope, view)
    expect(captured!.hasError).toBe(true)
    expect(captured!.errorMessage).toBe('syntax error')
  })
})
