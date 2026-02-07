/**
 * actorCritic Pattern Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockAction, mockFinalAction, mockCriticResult, mockBAMLClient } from '../../../mocks/baml'
import { mockCallTool, mockListTools, fixtures } from '../../../mocks/mcp'

// Mock server-only imports
vi.mock('../../../../lib/harness-patterns/assert.server', () => ({
  assertServerOnImport: vi.fn()
}))

// Mock MCP client
const callToolMock = mockCallTool({
  responses: {
    'code-mode': { result: 'Script executed successfully' },
    Return: { response: 'Done' }
  }
})

const listToolsMock = mockListTools(['code-mode', 'Return'])

vi.mock('../../../../lib/harness-patterns/mcp-client.server', () => ({
  callTool: callToolMock,
  listTools: listToolsMock
}))

// Mock BAML client
vi.mock('../../../../../baml_client', () => ({
  b: mockBAMLClient({
    actorActions: [
      mockAction({ tool_name: 'code-mode', tool_args: '{"script":"console.log(1)"}' }),
      mockFinalAction('Script complete')
    ],
    criticResults: [
      mockCriticResult({ is_sufficient: true })
    ]
  })
}))

describe('actorCritic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should export actorCritic function', async () => {
    const { actorCritic } = await import('../../../../lib/harness-patterns/patterns/actorCritic.server')
    expect(actorCritic).toBeDefined()
    expect(typeof actorCritic).toBe('function')
  })

  it('should create a ConfiguredPattern with name and config', async () => {
    const { actorCritic } = await import('../../../../lib/harness-patterns/patterns/actorCritic.server')
    const { createActorControllerAdapter, createCriticAdapter } = await import('../../../../lib/harness-patterns/baml-adapters.server')

    const actor = createActorControllerAdapter(['code-mode', 'Return'])
    const critic = createCriticAdapter()

    const pattern = actorCritic(actor, critic, ['code-mode', 'Return'], {
      patternId: 'test-actor-critic'
    })

    expect(pattern.name).toBe('actorCritic')
    expect(pattern.config.patternId).toBe('test-actor-critic')
    expect(pattern.fn).toBeDefined()
  })

  it('should use default maxRetries of MAX_RETRIES', async () => {
    const { actorCritic } = await import('../../../../lib/harness-patterns/patterns/actorCritic.server')
    const { MAX_RETRIES } = await import('../../../../lib/harness-patterns/types')
    const { createActorControllerAdapter, createCriticAdapter } = await import('../../../../lib/harness-patterns/baml-adapters.server')

    const actor = createActorControllerAdapter(['Return'])
    const critic = createCriticAdapter()

    const pattern = actorCritic(actor, critic, ['Return'])

    expect(pattern.name).toBe('actorCritic')
    expect(MAX_RETRIES).toBe(3)
  })

  it('should handle custom maxRetries config', async () => {
    const { actorCritic } = await import('../../../../lib/harness-patterns/patterns/actorCritic.server')
    const { createActorControllerAdapter, createCriticAdapter } = await import('../../../../lib/harness-patterns/baml-adapters.server')

    const actor = createActorControllerAdapter(['Return'])
    const critic = createCriticAdapter()

    const pattern = actorCritic(actor, critic, ['Return'], {
      maxRetries: 5,
      patternId: 'limited-critic'
    })

    expect(pattern.name).toBe('actorCritic')
    expect(pattern.config.patternId).toBe('limited-critic')
  })
})

describe('actorCritic execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should track controller_action and critic_result events', async () => {
    const { actorCritic } = await import('../../../../lib/harness-patterns/patterns/actorCritic.server')
    const { createScope } = await import('../../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../../lib/harness-patterns/patterns')

    // Create mock actor and critic
    const mockActor = vi.fn().mockResolvedValue({
      action: mockFinalAction('Done'),
      llmCall: undefined
    })

    const mockCritic = vi.fn().mockResolvedValue({
      result: mockCriticResult(),
      llmCall: undefined
    })

    const pattern = actorCritic(mockActor, mockCritic, ['Return'], {
      patternId: 'test',
      trackHistory: ['controller_action', 'critic_result']
    })

    // Create mock scope and view
    const scope = createScope('test', { intent: 'execute script' })
    const mockContext = {
      sessionId: 'test',
      createdAt: Date.now(),
      events: [
        { type: 'user_message' as const, ts: Date.now(), patternId: 'harness', data: { content: 'execute script' } }
      ],
      status: 'running' as const,
      data: {},
      input: 'execute script'
    }
    const view = createEventView(mockContext)

    // Execute pattern
    const result = await pattern.fn(scope, view)

    // Verify actor was called
    expect(mockActor).toHaveBeenCalled()
    expect(result).toBeDefined()
  })
})
