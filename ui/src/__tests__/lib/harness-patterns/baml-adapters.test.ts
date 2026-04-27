/**
 * BAML Adapters Tests
 *
 * Tests for controller and critic adapters that bridge patterns with BAML.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockAction, mockFinalAction, mockCriticResult } from '../../mocks/baml'
import { mockListTools } from '../../mocks/mcp'

// Mock server-only imports
vi.mock('../../../lib/harness-patterns/assert.server', () => ({
  assertServerOnImport: vi.fn()
}))

// Mock MCP listTools
vi.mock('../../../lib/harness-patterns/mcp-client.server', () => ({
  listTools: mockListTools(['read_neo4j_cypher', 'write_neo4j_cypher', 'Return'])
}))

// Mock BAML client
const mockLoopController = vi.fn()
const mockActorController = vi.fn()
const mockCritic = vi.fn()
const mockResultDescribe = vi.fn()

vi.mock('../../../../baml_client', () => ({
  b: {
    LoopController: mockLoopController,
    ActorController: mockActorController,
    Critic: mockCritic,
    ResultDescribe: (...args: unknown[]) => mockResultDescribe(...args)
  }
}))

describe('createLoopControllerAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoopController.mockResolvedValue(mockFinalAction())
  })

  it('should create a controller function', async () => {
    const { createLoopControllerAdapter } = await import('../../../lib/harness-patterns/baml-adapters.server')

    const controller = createLoopControllerAdapter(['read_neo4j_cypher', 'Return'])
    expect(controller).toBeDefined()
    expect(typeof controller).toBe('function')
  })

  it('should return action and llmCall data', async () => {
    const { createLoopControllerAdapter } = await import('../../../lib/harness-patterns/baml-adapters.server')

    const controller = createLoopControllerAdapter(['read_neo4j_cypher', 'Return'])

    const result = await controller('user message', 'intent', '[]', 0)

    expect(result.action).toBeDefined()
    expect(result.action.is_final).toBe(true)
  })

  it('should call LoopController with correct parameters', async () => {
    const { createLoopControllerAdapter } = await import('../../../lib/harness-patterns/baml-adapters.server')

    const controller = createLoopControllerAdapter(['read_neo4j_cypher', 'Return'], 'Custom context')

    await controller('user message', 'test intent', '[]', 0)

    expect(mockLoopController).toHaveBeenCalled()
    const [userMsg, intent] = mockLoopController.mock.calls[0]
    expect(userMsg).toBe('user message')
    expect(intent).toBe('test intent')
  })

  it('should pass contextPrefix as context when no schema', async () => {
    const { createLoopControllerAdapter } = await import('../../../lib/harness-patterns/baml-adapters.server')

    const controller = createLoopControllerAdapter(['Return'], 'Domain instructions here')

    await controller('msg', 'intent', '[]', 0)

    // context is 5th arg to LoopController
    const [, , , , context] = mockLoopController.mock.calls[0]
    expect(context).toBe('Domain instructions here')
  })

  it('should combine contextPrefix and schema in context', async () => {
    const { createLoopControllerAdapter } = await import('../../../lib/harness-patterns/baml-adapters.server')

    const controller = createLoopControllerAdapter(['Return'], 'Domain instructions')

    // schema is the 5th arg to the controller adapter
    await controller('msg', 'intent', '[]', 0, 'Node: Person, Company')

    const [, , , , context] = mockLoopController.mock.calls[0]
    expect(context).toContain('Domain instructions')
    expect(context).toContain('GRAPH SCHEMA:')
    expect(context).toContain('Node: Person, Company')
  })

  it('should pass undefined context when neither contextPrefix nor schema', async () => {
    const { createLoopControllerAdapter } = await import('../../../lib/harness-patterns/baml-adapters.server')

    const controller = createLoopControllerAdapter(['Return'])

    await controller('msg', 'intent', '[]', 0)

    const [, , , , context] = mockLoopController.mock.calls[0]
    expect(context).toBeUndefined()
  })
})

describe('createActorControllerAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockActorController.mockResolvedValue(mockFinalAction())
  })

  it('should create a controller function', async () => {
    const { createActorControllerAdapter } = await import('../../../lib/harness-patterns/baml-adapters.server')

    const controller = createActorControllerAdapter(['code-mode', 'Return'])
    expect(controller).toBeDefined()
    expect(typeof controller).toBe('function')
  })

  it('should return action and llmCall data', async () => {
    const { createActorControllerAdapter } = await import('../../../lib/harness-patterns/baml-adapters.server')

    const controller = createActorControllerAdapter(['code-mode', 'Return'])

    const result = await controller('user message', 'intent', ['code-mode'], [])

    expect(result.action).toBeDefined()
    expect(result.action.is_final).toBe(true)
  })
})

describe('createCriticAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCritic.mockResolvedValue(mockCriticResult())
  })

  it('should create a critic function', async () => {
    const { createCriticAdapter } = await import('../../../lib/harness-patterns/baml-adapters.server')

    const critic = createCriticAdapter()
    expect(critic).toBeDefined()
    expect(typeof critic).toBe('function')
  })

  it('should return result and llmCall data', async () => {
    const { createCriticAdapter } = await import('../../../lib/harness-patterns/baml-adapters.server')

    const critic = createCriticAdapter()

    const result = await critic('intent', [])

    expect(result.result).toBeDefined()
    expect(result.result.is_sufficient).toBe(true)
  })
})

describe('domain-specific adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoopController.mockResolvedValue(mockFinalAction())
  })

  it('should create Neo4j controller', async () => {
    const { createNeo4jController } = await import('../../../lib/harness-patterns/baml-adapters.server')

    const controller = createNeo4jController(['read_neo4j_cypher', 'Return'])
    expect(controller).toBeDefined()

    await controller('query', 'intent', '[]', 0)
    expect(mockLoopController).toHaveBeenCalled()
  })

  it('should create web search controller', async () => {
    const { createWebSearchController } = await import('../../../lib/harness-patterns/baml-adapters.server')

    const controller = createWebSearchController(['search', 'fetch', 'Return'])
    expect(controller).toBeDefined()

    await controller('search query', 'intent', '[]', 0)
    expect(mockLoopController).toHaveBeenCalled()
  })

  it('should create memory controller', async () => {
    const { createMemoryController } = await import('../../../lib/harness-patterns/baml-adapters.server')

    const controller = createMemoryController(['create_entities', 'Return'])
    expect(controller).toBeDefined()

    await controller('store this', 'intent', '[]', 0)
    expect(mockLoopController).toHaveBeenCalled()
  })

  it('should create Context7 controller', async () => {
    const { createContext7Controller } = await import('../../../lib/harness-patterns/baml-adapters.server')

    const controller = createContext7Controller(['resolve-library-id', 'Return'])
    expect(controller).toBeDefined()

    await controller('look up docs', 'intent', '[]', 0)
    expect(mockLoopController).toHaveBeenCalled()
  })

  it('should create GitHub controller', async () => {
    const { createGitHubController } = await import('../../../lib/harness-patterns/baml-adapters.server')

    const controller = createGitHubController(['search_code', 'Return'])
    expect(controller).toBeDefined()

    await controller('find code', 'intent', '[]', 0)
    expect(mockLoopController).toHaveBeenCalled()
  })

  it('should create filesystem controller', async () => {
    const { createFilesystemController } = await import('../../../lib/harness-patterns/baml-adapters.server')

    const controller = createFilesystemController(['read_file', 'Return'])
    expect(controller).toBeDefined()

    await controller('read file', 'intent', '[]', 0)
    expect(mockLoopController).toHaveBeenCalled()
  })

  it('should create Redis controller', async () => {
    const { createRedisController } = await import('../../../lib/harness-patterns/baml-adapters.server')

    const controller = createRedisController(['redis_get', 'Return'])
    expect(controller).toBeDefined()

    await controller('get key', 'intent', '[]', 0)
    expect(mockLoopController).toHaveBeenCalled()
  })

  it('should create database controller', async () => {
    const { createDatabaseController } = await import('../../../lib/harness-patterns/baml-adapters.server')

    const controller = createDatabaseController(['query', 'Return'])
    expect(controller).toBeDefined()

    await controller('run query', 'intent', '[]', 0)
    expect(mockLoopController).toHaveBeenCalled()
  })
})

describe('parseResultsToTurns', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoopController.mockResolvedValue(mockFinalAction())
  })

  it('should handle empty previous_results', async () => {
    const { createLoopControllerAdapter } = await import('../../../lib/harness-patterns/baml-adapters.server')

    const controller = createLoopControllerAdapter(['Return'])

    // Empty string should result in empty turns
    await controller('user message', 'intent', '', 0)
    expect(mockLoopController).toHaveBeenCalled()
  })

  it('should handle empty array previous_results', async () => {
    const { createLoopControllerAdapter } = await import('../../../lib/harness-patterns/baml-adapters.server')

    const controller = createLoopControllerAdapter(['Return'])

    await controller('user message', 'intent', '[]', 0)
    expect(mockLoopController).toHaveBeenCalled()
  })

  it('should handle array of results', async () => {
    const { createLoopControllerAdapter } = await import('../../../lib/harness-patterns/baml-adapters.server')

    const controller = createLoopControllerAdapter(['Return'])

    const results = JSON.stringify([
      { data: 'result1' },
      { data: 'result2' }
    ])

    await controller('user message', 'intent', results, 2)
    expect(mockLoopController).toHaveBeenCalled()

    // The turns should be passed to LoopController
    const calls = mockLoopController.mock.calls[0]
    expect(calls).toBeDefined()
  })

  it('should handle invalid JSON in previous_results', async () => {
    const { createLoopControllerAdapter } = await import('../../../lib/harness-patterns/baml-adapters.server')

    const controller = createLoopControllerAdapter(['Return'])

    // Invalid JSON should not throw, should result in empty turns
    await controller('user message', 'intent', 'not valid json', 0)
    expect(mockLoopController).toHaveBeenCalled()
  })

  it('should handle non-array JSON in previous_results', async () => {
    const { createLoopControllerAdapter } = await import('../../../lib/harness-patterns/baml-adapters.server')

    const controller = createLoopControllerAdapter(['Return'])

    // Object instead of array should result in empty turns
    await controller('user message', 'intent', '{"key": "value"}', 0)
    expect(mockLoopController).toHaveBeenCalled()
  })
})

describe('extractLLMCallData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should extract all fields from a collector with full data', async () => {
    const { extractLLMCallData } = await import('../../../lib/harness-patterns/baml-adapters.server')

    const collector = {
      last: {
        rawLlmResponse: '{"tool_name":"Return","is_final":true}',
        usage: { inputTokens: 150, outputTokens: 30, cachedInputTokens: 50 },
        calls: [{
          httpRequest: { body: '{"messages":[{"role":"user","content":"test"}]}' },
          provider: 'groq',
          clientName: 'GroqFast'
        }]
      }
    }

    const result = extractLLMCallData(
      collector as any,
      'LoopController',
      { user_message: 'test' },
      Date.now() - 100,
      { is_final: true }
    )

    expect(result).toBeDefined()
    expect(result!.functionName).toBe('LoopController')
    expect(result!.variables).toEqual({ user_message: 'test' })
    expect(result!.rawOutput).toBe('{"tool_name":"Return","is_final":true}')
    expect(result!.rawInput).toBe('{"messages":[{"role":"user","content":"test"}]}')
    expect(result!.parsedOutput).toEqual({ is_final: true })
    expect(result!.usage).toEqual({
      inputTokens: 150,
      outputTokens: 30,
      cachedInputTokens: 50,
      totalTokens: 180
    })
    expect(result!.provider).toBe('groq')
    expect(result!.clientName).toBe('GroqFast')
    expect(result!.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('should return undefined when collector has no last property', async () => {
    const { extractLLMCallData } = await import('../../../lib/harness-patterns/baml-adapters.server')

    const collector = { last: undefined }

    const result = extractLLMCallData(
      collector as any,
      'LoopController',
      {},
      Date.now()
    )

    expect(result).toBeUndefined()
  })

  it('should handle missing provider and clientName', async () => {
    const { extractLLMCallData } = await import('../../../lib/harness-patterns/baml-adapters.server')

    const collector = {
      last: {
        rawLlmResponse: 'output',
        usage: { inputTokens: 10, outputTokens: 5 },
        calls: [{ httpRequest: { body: {} } }]
      }
    }

    const result = extractLLMCallData(
      collector as any,
      'Synthesize',
      {},
      Date.now()
    )

    expect(result).toBeDefined()
    expect(result!.provider).toBeUndefined()
    expect(result!.clientName).toBeUndefined()
  })

  it('should handle httpRequest body as object', async () => {
    const { extractLLMCallData } = await import('../../../lib/harness-patterns/baml-adapters.server')

    const bodyObj = { messages: [{ role: 'user', content: 'test' }] }
    const collector = {
      last: {
        rawLlmResponse: 'output',
        calls: [{ httpRequest: { body: bodyObj } }]
      }
    }

    const result = extractLLMCallData(
      collector as any,
      'LoopController',
      {},
      Date.now()
    )

    expect(result).toBeDefined()
    expect(result!.rawInput).toBe(JSON.stringify(bodyObj, null, 2))
  })

  it('should handle missing usage data', async () => {
    const { extractLLMCallData } = await import('../../../lib/harness-patterns/baml-adapters.server')

    const collector = {
      last: {
        rawLlmResponse: 'output',
        calls: [{ httpRequest: { body: '{}' } }]
      }
    }

    const result = extractLLMCallData(
      collector as any,
      'LoopController',
      {},
      Date.now()
    )

    expect(result).toBeDefined()
    expect(result!.usage).toBeUndefined()
  })

  it('should handle missing calls array', async () => {
    const { extractLLMCallData } = await import('../../../lib/harness-patterns/baml-adapters.server')

    const collector = {
      last: {
        rawLlmResponse: 'output'
      }
    }

    const result = extractLLMCallData(
      collector as any,
      'LoopController',
      {},
      Date.now()
    )

    expect(result).toBeDefined()
    expect(result!.rawInput).toBeUndefined()
    expect(result!.provider).toBeUndefined()
    expect(result!.clientName).toBeUndefined()
  })
})

describe('describeToolResultOp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return summary from ResultDescribe', async () => {
    const { describeToolResultOp } = await import('../../../lib/harness-patterns/baml-adapters.server')
    mockResultDescribe.mockResolvedValue('Found 3 nodes in the graph.')

    const result = await describeToolResultOp('read_neo4j_cypher', '{"query":"MATCH (n) RETURN n"}', 'Need to list nodes', '[{name:"A"},{name:"B"},{name:"C"}]')

    expect(result).toBe('Found 3 nodes in the graph.')
    expect(mockResultDescribe).toHaveBeenCalledWith(
      'read_neo4j_cypher',
      '{"query":"MATCH (n) RETURN n"}',
      'Need to list nodes',
      '[{name:"A"},{name:"B"},{name:"C"}]'
    )
  })

  it('should return empty string on failure', async () => {
    const { describeToolResultOp } = await import('../../../lib/harness-patterns/baml-adapters.server')
    mockResultDescribe.mockRejectedValue(new Error('Model unavailable'))

    const result = await describeToolResultOp('search', '{}', '', 'data')

    expect(result).toBe('')
  })
})

describe('LoopController BamlValidationError fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should fall back to GroqGPT120B on BamlValidationError', async () => {
    const { createLoopControllerAdapter } = await import('../../../lib/harness-patterns/baml-adapters.server')
    const { BamlValidationError } = await import('@boundaryml/baml')

    // First call throws BamlValidationError, second call (GroqGPT120B) succeeds
    mockLoopController
      .mockRejectedValueOnce(new BamlValidationError('Invalid JSON output', 'raw output'))
      .mockResolvedValueOnce(mockFinalAction('Recovered'))

    const controller = createLoopControllerAdapter(['Return'])
    const result = await controller('user message', 'intent', '[]', 0)

    expect(result.action).toBeDefined()
    expect(result.action.is_final).toBe(true)
    expect(mockLoopController).toHaveBeenCalledTimes(2)
    // Second call should use GroqGPT120B client override
    const secondCallOptions = mockLoopController.mock.calls[1][7] ?? mockLoopController.mock.calls[1][6]
    expect(secondCallOptions).toEqual(expect.objectContaining({ client: 'GroqGPT120B' }))
  })

  it('should fall back to GroqFast when both primary and GroqGPT120B fail', async () => {
    const { createLoopControllerAdapter } = await import('../../../lib/harness-patterns/baml-adapters.server')
    const { BamlValidationError } = await import('@boundaryml/baml')

    // All three calls fail with BamlValidationError until GroqFast succeeds
    mockLoopController
      .mockRejectedValueOnce(new BamlValidationError('Invalid JSON', 'raw1'))
      .mockRejectedValueOnce(new BamlValidationError('Still invalid', 'raw2'))
      .mockResolvedValueOnce(mockFinalAction('Final recovery'))

    const controller = createLoopControllerAdapter(['Return'])
    const result = await controller('user message', 'intent', '[]', 0)

    expect(result.action).toBeDefined()
    expect(result.action.is_final).toBe(true)
    expect(mockLoopController).toHaveBeenCalledTimes(3)
    // Third call should use GroqFast client override
    const thirdCallOptions = mockLoopController.mock.calls[2][7] ?? mockLoopController.mock.calls[2][6]
    expect(thirdCallOptions).toEqual(expect.objectContaining({ client: 'GroqFast' }))
  })

  it('should propagate non-BamlValidationError errors', async () => {
    const { createLoopControllerAdapter } = await import('../../../lib/harness-patterns/baml-adapters.server')

    mockLoopController.mockRejectedValue(new Error('Network timeout'))

    const controller = createLoopControllerAdapter(['Return'])

    await expect(controller('user message', 'intent', '[]', 0)).rejects.toThrow('Network timeout')
    expect(mockLoopController).toHaveBeenCalledTimes(1)
  })

  it('should propagate non-BamlValidationError from GroqGPT120B fallback', async () => {
    const { createLoopControllerAdapter } = await import('../../../lib/harness-patterns/baml-adapters.server')
    const { BamlValidationError } = await import('@boundaryml/baml')

    mockLoopController
      .mockRejectedValueOnce(new BamlValidationError('Invalid JSON', 'raw'))
      .mockRejectedValueOnce(new Error('GroqGPT120B network error'))

    const controller = createLoopControllerAdapter(['Return'])

    await expect(controller('user message', 'intent', '[]', 0)).rejects.toThrow('GroqGPT120B network error')
    expect(mockLoopController).toHaveBeenCalledTimes(2)
  })
})

describe('priorResults parameter passing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoopController.mockResolvedValue(mockFinalAction())
  })

  it('should pass priorResults as 6th argument to LoopController', async () => {
    const { createLoopControllerAdapter } = await import('../../../lib/harness-patterns/baml-adapters.server')

    const controller = createLoopControllerAdapter(['Return'])

    const priorResults = [
      { ref_id: 'ev-abc', tool: 'search', summary: 'Found 3 results' }
    ]

    await controller('user message', 'intent', '[]', 0, undefined, undefined, priorResults)

    expect(mockLoopController).toHaveBeenCalled()
    // LoopController args: user_message, intent, tools, turns, context, priorResults
    const [, , , , , passedPrior] = mockLoopController.mock.calls[0]
    expect(passedPrior).toEqual(priorResults)
  })

  it('should pass undefined priorResults when not provided', async () => {
    const { createLoopControllerAdapter } = await import('../../../lib/harness-patterns/baml-adapters.server')

    const controller = createLoopControllerAdapter(['Return'])

    await controller('user message', 'intent', '[]', 0)

    expect(mockLoopController).toHaveBeenCalled()
    const [, , , , , passedPrior] = mockLoopController.mock.calls[0]
    expect(passedPrior).toBeUndefined()
  })
})
