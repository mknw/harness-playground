/**
 * simpleLoop Pattern Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockAction, mockFinalAction, mockBAMLClient } from '../../../mocks/baml'
import { mockCallTool, mockListTools, fixtures } from '../../../mocks/mcp'

// Mock server-only imports
vi.mock('../../../../lib/harness-patterns/assert.server', () => ({
  assertServerOnImport: vi.fn()
}))

// Mock MCP client
const callToolMock = mockCallTool({
  responses: {
    read_neo4j_cypher: fixtures.neo4j.queryResult,
    Return: { response: 'Done' }
  }
})

const listToolsMock = mockListTools(['read_neo4j_cypher', 'Return'])

vi.mock('../../../../lib/harness-patterns/mcp-client.server', () => ({
  callTool: callToolMock,
  listTools: listToolsMock
}))

// Mock BAML client
vi.mock('../../../../../baml_client', () => ({
  b: mockBAMLClient({
    loopActions: [
      mockAction({ tool_name: 'read_neo4j_cypher', tool_args: '{"query":"MATCH (n) RETURN n"}' }),
      mockFinalAction('Query complete')
    ]
  })
}))

describe('simpleLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should export simpleLoop function', async () => {
    const { simpleLoop } = await import('../../../../lib/harness-patterns/patterns/simpleLoop.server')
    expect(simpleLoop).toBeDefined()
    expect(typeof simpleLoop).toBe('function')
  })

  it('should create a ConfiguredPattern with name and config', async () => {
    const { simpleLoop } = await import('../../../../lib/harness-patterns/patterns/simpleLoop.server')
    const { createLoopControllerAdapter } = await import('../../../../lib/harness-patterns/baml-adapters.server')

    const controller = createLoopControllerAdapter(['read_neo4j_cypher', 'Return'])
    const pattern = simpleLoop(controller, ['read_neo4j_cypher', 'Return'], {
      patternId: 'test-loop'
    })

    expect(pattern.name).toBe('simpleLoop')
    expect(pattern.config.patternId).toBe('test-loop')
    expect(pattern.fn).toBeDefined()
  })

  it('should use default maxTurns of MAX_TOOL_TURNS', async () => {
    const { simpleLoop } = await import('../../../../lib/harness-patterns/patterns/simpleLoop.server')
    const { MAX_TOOL_TURNS } = await import('../../../../lib/harness-patterns/types')
    const { createLoopControllerAdapter } = await import('../../../../lib/harness-patterns/baml-adapters.server')

    const controller = createLoopControllerAdapter(['Return'])

    // Pattern should have been created with default maxTurns
    const pattern = simpleLoop(controller, ['Return'])

    // We can verify the pattern was created
    expect(pattern.name).toBe('simpleLoop')
    expect(MAX_TOOL_TURNS).toBe(5)
  })

  it('should handle custom maxTurns config', async () => {
    const { simpleLoop } = await import('../../../../lib/harness-patterns/patterns/simpleLoop.server')
    const { createLoopControllerAdapter } = await import('../../../../lib/harness-patterns/baml-adapters.server')

    const controller = createLoopControllerAdapter(['Return'])
    const pattern = simpleLoop(controller, ['Return'], {
      maxTurns: 3,
      patternId: 'limited-loop'
    })

    expect(pattern.name).toBe('simpleLoop')
    expect(pattern.config.patternId).toBe('limited-loop')
  })
})

describe('simpleLoop execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should track controller_action events', async () => {
    const { simpleLoop } = await import('../../../../lib/harness-patterns/patterns/simpleLoop.server')
    const { createScope } = await import('../../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../../lib/harness-patterns/patterns')

    // Create a mock controller that returns final immediately
    const mockController = vi.fn().mockResolvedValue({
      action: mockFinalAction('Done'),
      llmCall: undefined
    })

    const pattern = simpleLoop(mockController, ['Return'], {
      patternId: 'test',
      trackHistory: 'controller_action'
    })

    // Create mock scope and view
    const scope = createScope('test', { intent: 'test query' })
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

    // Execute pattern
    const result = await pattern.fn(scope, view)

    // Verify controller was called
    expect(mockController).toHaveBeenCalled()
    expect(result).toBeDefined()
  })

  it('should execute tool calls and track results', async () => {
    const { simpleLoop } = await import('../../../../lib/harness-patterns/patterns/simpleLoop.server')
    const { createScope } = await import('../../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../../lib/harness-patterns/patterns')

    // Controller that calls a tool then returns final
    const mockController = vi.fn()
      .mockResolvedValueOnce({
        action: mockAction({
          tool_name: 'read_neo4j_cypher',
          tool_args: '{"query":"MATCH (n) RETURN n"}'
        }),
        llmCall: undefined
      })
      .mockResolvedValueOnce({
        action: mockFinalAction('Query complete'),
        llmCall: undefined
      })

    const pattern = simpleLoop(mockController, ['read_neo4j_cypher', 'Return'], {
      patternId: 'test',
      trackHistory: true
    })

    const scope = createScope('test', { intent: 'test query' })
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

    // Should have tracked tool_call and tool_result events
    const toolCalls = result.events.filter(e => e.type === 'tool_call')
    const toolResults = result.events.filter(e => e.type === 'tool_result')
    expect(toolCalls.length).toBeGreaterThanOrEqual(1)
    expect(toolResults.length).toBeGreaterThanOrEqual(1)
  })

  it('should track error when tool not in allowed list', async () => {
    const { simpleLoop } = await import('../../../../lib/harness-patterns/patterns/simpleLoop.server')
    const { createScope } = await import('../../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../../lib/harness-patterns/patterns')

    const mockController = vi.fn().mockResolvedValue({
      action: mockAction({ tool_name: 'forbidden_tool', tool_args: '{}' }),
      llmCall: undefined
    })

    const pattern = simpleLoop(mockController, ['allowed_tool'], {
      patternId: 'test'
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
    expect(JSON.stringify(errorEvents[0].data)).toContain('Tool not allowed')
  })

  it('should track error when tool_args JSON is invalid', async () => {
    const { simpleLoop } = await import('../../../../lib/harness-patterns/patterns/simpleLoop.server')
    const { createScope } = await import('../../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../../lib/harness-patterns/patterns')

    const mockController = vi.fn().mockResolvedValue({
      action: mockAction({ tool_name: 'read_neo4j_cypher', tool_args: 'not valid json' }),
      llmCall: undefined
    })

    const pattern = simpleLoop(mockController, ['read_neo4j_cypher'], {
      patternId: 'test'
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
    expect(JSON.stringify(errorEvents[0].data)).toContain('Invalid tool_args JSON')
  })

  it('should track error when tool execution fails', async () => {
    const { simpleLoop } = await import('../../../../lib/harness-patterns/patterns/simpleLoop.server')
    const { createScope } = await import('../../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../../lib/harness-patterns/patterns')

    // Override callTool to return failure
    callToolMock.mockResolvedValueOnce({
      success: false,
      data: null,
      error: 'Connection failed'
    })

    const mockController = vi.fn().mockResolvedValue({
      action: mockAction({ tool_name: 'read_neo4j_cypher', tool_args: '{"query":"test"}' }),
      llmCall: undefined
    })

    const pattern = simpleLoop(mockController, ['read_neo4j_cypher'], {
      patternId: 'test'
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
    expect(JSON.stringify(errorEvents[0].data)).toContain('Connection failed')
  })

  it('should propagate error state to scope.data when tool fails', async () => {
    const { simpleLoop } = await import('../../../../lib/harness-patterns/patterns/simpleLoop.server')
    const { createScope } = await import('../../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../../lib/harness-patterns/patterns')

    // Override callTool to return failure
    callToolMock.mockResolvedValueOnce({
      success: false,
      data: null,
      error: 'Tool execution failed'
    })

    const mockController = vi.fn().mockResolvedValue({
      action: mockAction({ tool_name: 'read_neo4j_cypher', tool_args: '{"query":"test"}' }),
      llmCall: undefined
    })

    const pattern = simpleLoop(mockController, ['read_neo4j_cypher'], {
      patternId: 'test'
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

    // Verify error state is propagated to scope.data
    expect(result.data.hasError).toBe(true)
    expect(result.data.errorMessage).toBe('Tool execution failed')
    expect(result.data.resultEventIds).toBeDefined()
  })

  it('should propagate error state to scope.data when controller crashes', async () => {
    const { simpleLoop } = await import('../../../../lib/harness-patterns/patterns/simpleLoop.server')
    const { createScope } = await import('../../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../../lib/harness-patterns/patterns')

    const mockController = vi.fn().mockRejectedValue(new Error('Controller exception'))

    const pattern = simpleLoop(mockController, ['Return'], {
      patternId: 'test'
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

    // Verify error state is propagated to scope.data
    expect(result.data.hasError).toBe(true)
    expect(result.data.errorMessage).toBe('Controller exception')
  })

  it('should handle controller errors gracefully', async () => {
    const { simpleLoop } = await import('../../../../lib/harness-patterns/patterns/simpleLoop.server')
    const { createScope } = await import('../../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../../lib/harness-patterns/patterns')

    const mockController = vi.fn().mockRejectedValue(new Error('Controller crashed'))

    const pattern = simpleLoop(mockController, ['Return'], {
      patternId: 'test'
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
    expect(JSON.stringify(errorEvents[0].data)).toContain('Controller crashed')
  })

  it('should accumulate results across iterations', async () => {
    const { simpleLoop } = await import('../../../../lib/harness-patterns/patterns/simpleLoop.server')
    const { createScope } = await import('../../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../../lib/harness-patterns/patterns')

    // Restore callTool to return success
    callToolMock.mockResolvedValue({
      success: true,
      data: { result: 'tool result' }
    })

    const mockController = vi.fn()
      .mockResolvedValueOnce({
        action: mockAction({ tool_name: 'read_neo4j_cypher', tool_args: '{}' }),
        llmCall: undefined
      })
      .mockResolvedValueOnce({
        action: mockAction({ tool_name: 'read_neo4j_cypher', tool_args: '{}' }),
        llmCall: undefined
      })
      .mockResolvedValueOnce({
        action: mockFinalAction('Done'),
        llmCall: undefined
      })

    const pattern = simpleLoop(mockController, ['read_neo4j_cypher', 'Return'], {
      patternId: 'test'
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

    // Should have accumulated result event IDs
    expect(result.data.resultEventIds).toBeDefined()
    expect((result.data.resultEventIds as string[]).length).toBe(2)
  })

  it('should include callId on tool_call and tool_result events', async () => {
    const { simpleLoop } = await import('../../../../lib/harness-patterns/patterns/simpleLoop.server')
    const { createScope } = await import('../../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../../lib/harness-patterns/patterns')

    callToolMock.mockResolvedValue({
      success: true,
      data: { result: 'tool result' }
    })

    const mockController = vi.fn()
      .mockResolvedValueOnce({
        action: mockAction({ tool_name: 'read_neo4j_cypher', tool_args: '{}' }),
        llmCall: undefined
      })
      .mockResolvedValueOnce({
        action: mockFinalAction('Done'),
        llmCall: undefined
      })

    const pattern = simpleLoop(mockController, ['read_neo4j_cypher', 'Return'], {
      patternId: 'test',
      trackHistory: true
    })

    const scope = createScope('test', { intent: 'test query' })
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

    const toolCalls = result.events.filter(e => e.type === 'tool_call')
    const toolResults = result.events.filter(e => e.type === 'tool_result')
    expect(toolCalls.length).toBeGreaterThanOrEqual(1)
    expect(toolResults.length).toBeGreaterThanOrEqual(1)

    // Both should have callId
    const callData = toolCalls[0].data as { callId?: string; tool: string }
    const resultData = toolResults[0].data as { callId?: string; tool: string }
    expect(callData.callId).toBeDefined()
    expect(resultData.callId).toBeDefined()
    // callId should match between call and result
    expect(callData.callId).toBe(resultData.callId)
  })

  it('should use existing results from scope data', async () => {
    const { simpleLoop } = await import('../../../../lib/harness-patterns/patterns/simpleLoop.server')
    const { createScope } = await import('../../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../../lib/harness-patterns/patterns')

    const mockController = vi.fn().mockResolvedValue({
      action: mockFinalAction('Done'),
      llmCall: undefined
    })

    const pattern = simpleLoop(mockController, ['Return'], {
      patternId: 'test'
    })

    // Start with existing result event IDs
    const scope = createScope('test', { resultEventIds: ['ev-previous'] })
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

    // Should preserve existing result event IDs
    expect(result.data.resultEventIds).toContain('ev-previous')
  })
})
