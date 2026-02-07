/**
 * Agent Harness Tests
 *
 * Tests for all agent harnesses in the examples directory.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { mockFinalAction, mockCriticResult } from '../../../mocks/baml'
import { mockCallTool, mockListTools } from '../../../mocks/mcp'

// ============================================================================
// Mock Setup
// ============================================================================

const mockToolSets = {
  neo4j: ['read_neo4j_cypher', 'write_neo4j_cypher', 'get_neo4j_schema', 'Return'],
  web: ['search', 'fetch', 'fetch_content', 'Return'],
  memory: [
    'create_entities', 'create_relations', 'add_observations',
    'delete_entities', 'delete_relations', 'delete_observations',
    'open_nodes', 'search_nodes', 'read_graph', 'Return'
  ],
  github: [
    'get_issue', 'list_issues', 'create_issue', 'search_code',
    'search_repositories', 'get_pull_request', 'Return'
  ],
  context7: ['resolve-library-id', 'get-library-docs', 'Return'],
  filesystem: [
    'read_text_file', 'write_file', 'edit_file', 'list_directory',
    'directory_tree', 'search_files', 'search_files_content', 'Return'
  ],
  redis: ['get', 'set', 'hset', 'hget', 'expire', 'json_get', 'json_set', 'vector_search_hash', 'Return'],
  all: [] as string[]
}

mockToolSets.all = [
  ...new Set([
    ...mockToolSets.neo4j,
    ...mockToolSets.web,
    ...mockToolSets.memory,
    ...mockToolSets.github,
    ...mockToolSets.context7,
    ...mockToolSets.filesystem,
    ...mockToolSets.redis
  ])
]

// Mock assert.server for all harness files
vi.mock('../../../../lib/harness-patterns/assert.server', () => ({
  assertServerOnImport: vi.fn()
}))

// Mock MCP client
vi.mock('../../../../lib/harness-patterns/mcp-client.server', () => ({
  callTool: mockCallTool({
    responses: {
      get_neo4j_schema: { nodes: ['Person'], relationships: ['KNOWS'] },
      read_graph: { entities: [], relations: [] }
    }
  }),
  listTools: mockListTools(mockToolSets.all)
}))

// Mock BAML client
vi.mock('../../../../../baml_client', () => ({
  b: {
    LoopController: vi.fn(async () => mockFinalAction()),
    ActorController: vi.fn(async () => mockFinalAction()),
    Critic: vi.fn(async () => mockCriticResult()),
    Router: vi.fn(async () => ({
      intent: 'test',
      needs_tool: true,
      route: 'neo4j',
      response: ''
    })),
    Synthesize: vi.fn(async () => 'Synthesized response')
  }
}))

// Mock Collector
vi.mock('@boundaryml/baml', () => ({
  Collector: vi.fn().mockImplementation(() => ({
    last: {
      rawLlmResponse: 'Raw response',
      usage: { inputTokens: 100, outputTokens: 50 },
      calls: [{ httpRequest: { body: {} } }]
    }
  }))
}))

// Mock Tools function
vi.mock('../../../../lib/harness-patterns/tools.server', () => ({
  Tools: vi.fn(async () => mockToolSets),
  ToolsFrom: vi.fn(async () => mockToolSets)
}))

// ============================================================================
// Helper Functions
// ============================================================================

interface AgentConfig {
  id: string
  name: string
  description: string
  icon: string
  servers: string[]
  createPatterns: () => Promise<unknown[]>
}

function validateAgentConfig(config: AgentConfig) {
  expect(config.id).toBeDefined()
  expect(config.id).toMatch(/^[a-z0-9-]+$/)
  expect(config.name).toBeDefined()
  expect(config.name.length).toBeGreaterThan(0)
  expect(config.description).toBeDefined()
  expect(config.icon).toBeDefined()
  expect(config.servers).toBeInstanceOf(Array)
  expect(config.createPatterns).toBeDefined()
  expect(typeof config.createPatterns).toBe('function')
}

interface Pattern {
  name: string
  fn: unknown
  config: { patternId?: string }
}

async function validatePatterns(config: AgentConfig): Promise<Pattern[]> {
  const patterns = await config.createPatterns() as Pattern[]

  expect(patterns).toBeInstanceOf(Array)
  expect(patterns.length).toBeGreaterThan(0)

  const patternIds = new Set<string>()

  for (const pattern of patterns) {
    expect(pattern.name).toBeDefined()
    expect(pattern.fn).toBeDefined()
    expect(pattern.config).toBeDefined()
    expect(pattern.config.patternId).toBeDefined()

    // Check for unique pattern IDs
    expect(patternIds.has(pattern.config.patternId!)).toBe(false)
    patternIds.add(pattern.config.patternId!)
  }

  return patterns
}

// ============================================================================
// Tests
// ============================================================================

describe('Agent Harnesses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('defaultAgent', () => {
    it('should have valid config', async () => {
      const { defaultAgent } = await import('../../../../lib/harness-client/examples/default.server')
      validateAgentConfig(defaultAgent)
      expect(defaultAgent.id).toBe('default')
      expect(defaultAgent.servers).toContain('neo4j-cypher')
    })

    it('should create valid patterns', async () => {
      const { defaultAgent } = await import('../../../../lib/harness-client/examples/default.server')
      const patterns = await validatePatterns(defaultAgent)

      // Should have router and synthesizer
      const patternNames = patterns.map(p => p.name)
      expect(patternNames).toContain('router')
      expect(patternNames).toContain('synthesizer')
    })

    it('should have unique pattern IDs', async () => {
      const { defaultAgent } = await import('../../../../lib/harness-client/examples/default.server')
      const patterns = await defaultAgent.createPatterns() as Pattern[]
      const ids = patterns.map(p => p.config.patternId)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(ids.length)
    })
  })

  describe('conversationalMemoryAgent', () => {
    it('should have valid config', async () => {
      const { conversationalMemoryAgent } = await import('../../../../lib/harness-client/examples/conversational-memory.server')
      validateAgentConfig(conversationalMemoryAgent)
      expect(conversationalMemoryAgent.id).toBe('conversational-memory')
      expect(conversationalMemoryAgent.servers).toContain('memory')
    })

    it('should create valid patterns', async () => {
      const { conversationalMemoryAgent } = await import('../../../../lib/harness-client/examples/conversational-memory.server')
      const patterns = await validatePatterns(conversationalMemoryAgent)

      // Should include session tracker, router, memory writer, synthesizer
      expect(patterns.length).toBeGreaterThanOrEqual(4)
    })

    it('should include session tracking pattern', async () => {
      const { conversationalMemoryAgent } = await import('../../../../lib/harness-client/examples/conversational-memory.server')
      const patterns = await conversationalMemoryAgent.createPatterns() as Pattern[]
      const hasSessionTracker = patterns.some(p => p.config.patternId === 'session-tracker')
      expect(hasSessionTracker).toBe(true)
    })
  })

  describe('docAssistantAgent', () => {
    it('should have valid config', async () => {
      const { docAssistantAgent } = await import('../../../../lib/harness-client/examples/doc-assistant.server')
      validateAgentConfig(docAssistantAgent)
      expect(docAssistantAgent.id).toBe('doc-assistant')
      expect(docAssistantAgent.servers).toContain('context7')
    })

    it('should create valid patterns', async () => {
      const { docAssistantAgent } = await import('../../../../lib/harness-client/examples/doc-assistant.server')
      const patterns = await validatePatterns(docAssistantAgent)

      // Should have doc lookup, memory store, synthesizer
      expect(patterns.length).toBe(3)
    })

    it('should start with doc lookup pattern', async () => {
      const { docAssistantAgent } = await import('../../../../lib/harness-client/examples/doc-assistant.server')
      const patterns = await docAssistantAgent.createPatterns() as Pattern[]
      expect(patterns[0].config.patternId).toBe('doc-lookup')
    })
  })

  describe('guardrailedAgent', () => {
    it('should have valid config', async () => {
      const { guardrailedAgent } = await import('../../../../lib/harness-client/examples/guardrailed-agent.server')
      validateAgentConfig(guardrailedAgent)
      expect(guardrailedAgent.id).toBe('guardrailed-agent')
    })

    it('should create valid patterns', async () => {
      const { guardrailedAgent } = await import('../../../../lib/harness-client/examples/guardrailed-agent.server')
      const patterns = await validatePatterns(guardrailedAgent)

      // Should have guardrailed editor and synthesizer
      expect(patterns.length).toBe(2)
    })

    it('should include guardrail pattern', async () => {
      const { guardrailedAgent } = await import('../../../../lib/harness-client/examples/guardrailed-agent.server')
      const patterns = await guardrailedAgent.createPatterns() as Pattern[]
      // guardrail pattern name includes wrapped pattern: 'guardrail(withApproval)'
      const hasGuardrail = patterns.some(p => p.name.startsWith('guardrail('))
      expect(hasGuardrail).toBe(true)
    })
  })

  describe('issueTriageAgent', () => {
    it('should have valid config', async () => {
      const { issueTriageAgent } = await import('../../../../lib/harness-client/examples/issue-triage.server')
      validateAgentConfig(issueTriageAgent)
      expect(issueTriageAgent.id).toBe('issue-triage')
      expect(issueTriageAgent.servers).toContain('github')
    })

    it('should create valid patterns', async () => {
      const { issueTriageAgent } = await import('../../../../lib/harness-client/examples/issue-triage.server')
      const patterns = await validatePatterns(issueTriageAgent)

      // Should have router and synthesizer
      expect(patterns.length).toBe(2)
    })
  })

  describe('kgBuilderAgent', () => {
    it('should have valid config', async () => {
      const { kgBuilderAgent } = await import('../../../../lib/harness-client/examples/kg-builder.server')
      validateAgentConfig(kgBuilderAgent)
      expect(kgBuilderAgent.id).toBe('kg-builder')
    })

    it('should create valid patterns', async () => {
      const { kgBuilderAgent } = await import('../../../../lib/harness-client/examples/kg-builder.server')
      const patterns = await validatePatterns(kgBuilderAgent)

      // Should have web research, memory extract, neo4j persist, synthesizer
      expect(patterns.length).toBe(4)
    })

    it('should include approval pattern for neo4j persist', async () => {
      const { kgBuilderAgent } = await import('../../../../lib/harness-client/examples/kg-builder.server')
      const patterns = await kgBuilderAgent.createPatterns() as Pattern[]
      const hasApproval = patterns.some(p => p.name === 'withApproval')
      expect(hasApproval).toBe(true)
    })
  })

  describe('llmJudgeAgent', () => {
    it('should have valid config', async () => {
      const { llmJudgeAgent } = await import('../../../../lib/harness-client/examples/llm-judge.server')
      validateAgentConfig(llmJudgeAgent)
      expect(llmJudgeAgent.id).toBe('llm-judge')
    })

    it('should create valid patterns', async () => {
      const { llmJudgeAgent } = await import('../../../../lib/harness-client/examples/llm-judge.server')
      const patterns = await validatePatterns(llmJudgeAgent)

      // Should have parallel sources, judge, synthesizer
      expect(patterns.length).toBe(3)
    })

    it('should include parallel and judge patterns', async () => {
      const { llmJudgeAgent } = await import('../../../../lib/harness-client/examples/llm-judge.server')
      const patterns = await llmJudgeAgent.createPatterns() as Pattern[]
      const names = patterns.map(p => p.name)
      expect(names).toContain('parallel')
      // judge pattern uses patternId as name
      const hasJudge = patterns.some(p => p.config.patternId?.includes('judge'))
      expect(hasJudge).toBe(true)
    })
  })

  describe('multiSourceResearchAgent', () => {
    it('should have valid config', async () => {
      const { multiSourceResearchAgent } = await import('../../../../lib/harness-client/examples/multi-source-research.server')
      validateAgentConfig(multiSourceResearchAgent)
      expect(multiSourceResearchAgent.id).toBe('multi-source-research')
    })

    it('should create valid patterns', async () => {
      const { multiSourceResearchAgent } = await import('../../../../lib/harness-client/examples/multi-source-research.server')
      const patterns = await validatePatterns(multiSourceResearchAgent)

      // Should have parallel, judge, synthesizer
      expect(patterns.length).toBe(3)
    })
  })

  describe('ontologyBuilderAgent', () => {
    it('should have valid config', async () => {
      const { ontologyBuilderAgent } = await import('../../../../lib/harness-client/examples/ontology-builder.server')
      validateAgentConfig(ontologyBuilderAgent)
      expect(ontologyBuilderAgent.id).toBe('ontology-builder')
    })

    it('should create valid patterns', async () => {
      const { ontologyBuilderAgent } = await import('../../../../lib/harness-client/examples/ontology-builder.server')
      const patterns = await validatePatterns(ontologyBuilderAgent)

      // Complex agent with many phases
      expect(patterns.length).toBeGreaterThanOrEqual(5)
    })

    it('should include multiple pattern types', async () => {
      const { ontologyBuilderAgent } = await import('../../../../lib/harness-client/examples/ontology-builder.server')
      const patterns = await ontologyBuilderAgent.createPatterns() as Pattern[]
      const names = new Set(patterns.map(p => p.name))

      // Should use variety of patterns
      expect(names.size).toBeGreaterThanOrEqual(3)
    })
  })

  describe('semanticCacheAgent', () => {
    it('should have valid config', async () => {
      const { semanticCacheAgent } = await import('../../../../lib/harness-client/examples/semantic-cache.server')
      validateAgentConfig(semanticCacheAgent)
      expect(semanticCacheAgent.id).toBe('semantic-cache')
      expect(semanticCacheAgent.servers).toContain('redis')
    })

    it('should create valid patterns', async () => {
      const { semanticCacheAgent } = await import('../../../../lib/harness-client/examples/semantic-cache.server')
      const patterns = await validatePatterns(semanticCacheAgent)

      // Should have cache check, conditional retrieval, cache writer, synthesizer
      expect(patterns.length).toBe(4)
    })

    it('should start with cache check pattern', async () => {
      const { semanticCacheAgent } = await import('../../../../lib/harness-client/examples/semantic-cache.server')
      const patterns = await semanticCacheAgent.createPatterns() as Pattern[]
      expect(patterns[0].config.patternId).toBe('semantic-cache')
    })
  })
})

// ============================================================================
// Cross-Agent Tests
// ============================================================================

describe('Agent Consistency', () => {
  it('all agents should have unique IDs', async () => {
    // Import all agents statically
    const { defaultAgent } = await import('../../../../lib/harness-client/examples/default.server')
    const { conversationalMemoryAgent } = await import('../../../../lib/harness-client/examples/conversational-memory.server')
    const { docAssistantAgent } = await import('../../../../lib/harness-client/examples/doc-assistant.server')
    const { guardrailedAgent } = await import('../../../../lib/harness-client/examples/guardrailed-agent.server')
    const { issueTriageAgent } = await import('../../../../lib/harness-client/examples/issue-triage.server')
    const { kgBuilderAgent } = await import('../../../../lib/harness-client/examples/kg-builder.server')
    const { llmJudgeAgent } = await import('../../../../lib/harness-client/examples/llm-judge.server')
    const { multiSourceResearchAgent } = await import('../../../../lib/harness-client/examples/multi-source-research.server')
    const { ontologyBuilderAgent } = await import('../../../../lib/harness-client/examples/ontology-builder.server')
    const { semanticCacheAgent } = await import('../../../../lib/harness-client/examples/semantic-cache.server')

    const ids = [
      defaultAgent.id,
      conversationalMemoryAgent.id,
      docAssistantAgent.id,
      guardrailedAgent.id,
      issueTriageAgent.id,
      kgBuilderAgent.id,
      llmJudgeAgent.id,
      multiSourceResearchAgent.id,
      ontologyBuilderAgent.id,
      semanticCacheAgent.id
    ]

    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })

  it('all agents should contain synthesizer pattern', async () => {
    const { defaultAgent } = await import('../../../../lib/harness-client/examples/default.server')
    const { conversationalMemoryAgent } = await import('../../../../lib/harness-client/examples/conversational-memory.server')
    const { docAssistantAgent } = await import('../../../../lib/harness-client/examples/doc-assistant.server')
    const { guardrailedAgent } = await import('../../../../lib/harness-client/examples/guardrailed-agent.server')
    const { issueTriageAgent } = await import('../../../../lib/harness-client/examples/issue-triage.server')
    const { kgBuilderAgent } = await import('../../../../lib/harness-client/examples/kg-builder.server')
    const { llmJudgeAgent } = await import('../../../../lib/harness-client/examples/llm-judge.server')
    const { multiSourceResearchAgent } = await import('../../../../lib/harness-client/examples/multi-source-research.server')
    const { ontologyBuilderAgent } = await import('../../../../lib/harness-client/examples/ontology-builder.server')
    const { semanticCacheAgent } = await import('../../../../lib/harness-client/examples/semantic-cache.server')

    const agents = [
      defaultAgent,
      conversationalMemoryAgent,
      docAssistantAgent,
      guardrailedAgent,
      issueTriageAgent,
      kgBuilderAgent,
      llmJudgeAgent,
      multiSourceResearchAgent,
      ontologyBuilderAgent,
      semanticCacheAgent
    ]

    for (const config of agents) {
      const patterns = await config.createPatterns() as Pattern[]
      // All agents should contain a synthesizer pattern somewhere in the chain
      const hasSynthesizer = patterns.some(p => p.name === 'synthesizer')
      expect(hasSynthesizer).toBe(true)
    }
  })
})
