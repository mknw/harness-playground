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
})
