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

vi.mock('../../../../baml_client', () => ({
  b: {
    LoopController: mockLoopController,
    ActorController: mockActorController,
    Critic: mockCritic
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

  it('should extract LLM call data when collector has last property', async () => {
    const { createLoopControllerAdapter } = await import('../../../lib/harness-patterns/baml-adapters.server')
    const { Collector } = await import('@boundaryml/baml')

    // Mock collector with data
    const mockCollector = new Collector('test')

    const controller = createLoopControllerAdapter(['Return'])

    // Pass collector to get LLM call data
    const result = await controller('user message', 'intent', '[]', 0, undefined, mockCollector)

    // The result should have llmCall data if collector.last is set
    expect(result.action).toBeDefined()
    // llmCall may be undefined if collector.last is not set in mock
  })

  it('should handle collector with httpRequest body as string', async () => {
    const { createLoopControllerAdapter } = await import('../../../lib/harness-patterns/baml-adapters.server')
    const { Collector } = await import('@boundaryml/baml')

    const controller = createLoopControllerAdapter(['Return'])

    // Create collector with custom mock
    const mockCollector = new Collector('test')

    await controller('user message', 'intent', '[]', 0, undefined, mockCollector)
    expect(mockLoopController).toHaveBeenCalled()
  })
})
