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
