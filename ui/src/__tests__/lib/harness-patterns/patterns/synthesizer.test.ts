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

// Mock Collector
vi.mock('@boundaryml/baml', () => ({
  Collector: vi.fn().mockImplementation(() => ({
    last: {
      rawLlmResponse: 'Raw response',
      usage: { inputTokens: 100, outputTokens: 50 },
      calls: [{ httpRequest: { body: { messages: [] } } }]
    }
  }))
}))

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
})
