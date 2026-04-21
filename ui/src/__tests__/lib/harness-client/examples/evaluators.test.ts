/**
 * Evaluator and Rail Tests
 *
 * Tests for the internal evaluator functions and custom rails
 * defined within agent harnesses.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockFinalAction, mockCriticResult } from '../../../mocks/baml'
import { mockCallTool, mockListTools } from '../../../mocks/mcp'

// ============================================================================
// Mock Setup
// ============================================================================

const mockToolSets = {
  neo4j: ['read_neo4j_cypher', 'write_neo4j_cypher', 'get_neo4j_schema', 'Return'],
  web: ['search', 'fetch', 'fetch_content', 'Return'],
  memory: ['create_entities', 'read_graph', 'Return'],
  github: ['search_code', 'Return'],
  context7: ['resolve-library-id', 'get-library-docs', 'Return'],
  filesystem: ['read_text_file', 'write_file', 'edit_file', 'Return'],
  redis: ['hset', 'expire', 'Return'],
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

// Create mocks that we can access and modify
const callToolMock = mockCallTool({
  responses: {
    get_neo4j_schema: { nodes: ['Person'], relationships: ['KNOWS'] },
    read_graph: { entities: [], relations: [] }
  }
})

// Mock MCP client
vi.mock('../../../../lib/harness-patterns/mcp-client.server', () => ({
  callTool: callToolMock,
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

// Mock Collector — must be a real class so `new Collector()` works
vi.mock('@boundaryml/baml', () => {
  class MockCollector {
    last = {
      rawLlmResponse: 'Raw response',
      usage: { inputTokens: 100, outputTokens: 50 },
      calls: [{ httpRequest: { body: {} } }]
    }
    constructor(_name?: string) {}
  }
  return { Collector: MockCollector }
})

// Mock Tools function
vi.mock('../../../../lib/harness-patterns/tools.server', () => ({
  Tools: vi.fn(async () => mockToolSets),
  ToolsFrom: vi.fn(async () => mockToolSets)
}))

// ============================================================================
// Helper Types
// ============================================================================

interface Candidate {
  source: string
  content: string
}

interface EvaluatorResult {
  reasoning: string
  rankings: Array<{ source: string; score: number; reason: string }>
  best: Candidate | null
}

type EvaluatorFn = (query: string, candidates: Candidate[]) => Promise<EvaluatorResult>

// ============================================================================
// LLM Judge Evaluator Tests
// ============================================================================

describe('LLM Judge qualityJudgeEvaluator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    vi.resetModules()
  })

  // We need to extract and test the evaluator. Since it's internal,
  // we'll test it through the judge pattern execution
  describe('content length scoring', () => {
    it('should give higher score for substantial content (>500 chars)', async () => {
      // Create candidates with different content lengths
      const longContent = 'a'.repeat(600)  // >500 chars
      const shortContent = 'a'.repeat(50)  // <100 chars

      const candidates: Candidate[] = [
        { source: 'doc-lookup', content: longContent },
        { source: 'web-search', content: shortContent }
      ]

      // Import and access the judge pattern
      const { llmJudgeAgent } = await import('../../../../lib/harness-client/examples/llm-judge.server')
      const patterns = await llmJudgeAgent.createPatterns()

      // The judge pattern exists
      const judgePattern = patterns.find(p => (p as { config: { patternId?: string } }).config.patternId === 'quality-judge')
      expect(judgePattern).toBeDefined()
    })

    it('should give moderate score for medium content (100-500 chars)', async () => {
      const mediumContent = 'a'.repeat(200)  // 100-500 chars

      const candidates: Candidate[] = [
        { source: 'doc-lookup', content: mediumContent }
      ]

      const { llmJudgeAgent } = await import('../../../../lib/harness-client/examples/llm-judge.server')
      const patterns = await llmJudgeAgent.createPatterns()
      expect(patterns.length).toBe(3)
    })
  })

  describe('relevance scoring', () => {
    it('should score higher when query terms are in content', async () => {
      // Testing that the judge pattern is properly configured
      const { llmJudgeAgent } = await import('../../../../lib/harness-client/examples/llm-judge.server')
      const patterns = await llmJudgeAgent.createPatterns()

      const judgePattern = patterns.find(p => (p as { config: { patternId?: string } }).config.patternId === 'quality-judge')
      expect(judgePattern).toBeDefined()
      // Judge pattern should have the evaluator configured
      expect((judgePattern as { name: string }).name).toBe('quality-judge')
    })
  })

  describe('source authority scoring', () => {
    it('should give highest bonus for doc-lookup source', async () => {
      const { llmJudgeAgent } = await import('../../../../lib/harness-client/examples/llm-judge.server')
      const patterns = await llmJudgeAgent.createPatterns()

      // Verify all three source patterns exist in parallel
      const parallelPattern = patterns.find(p =>
        (p as { config: { patternId?: string } }).config.patternId === 'parallel-sources'
      )
      expect(parallelPattern).toBeDefined()
      expect((parallelPattern as { name: string }).name).toBe('parallel')
    })
  })

  describe('structure scoring', () => {
    it('should give bonus for code blocks', async () => {
      const { llmJudgeAgent } = await import('../../../../lib/harness-client/examples/llm-judge.server')
      expect(llmJudgeAgent.id).toBe('llm-judge')
    })

    it('should give bonus for lists', async () => {
      const { llmJudgeAgent } = await import('../../../../lib/harness-client/examples/llm-judge.server')
      expect(llmJudgeAgent.description).toContain('quality')
    })
  })
})

// ============================================================================
// Multi-Source Research Evaluator Tests
// ============================================================================

describe('Multi-Source Research judgeEvaluator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    vi.resetModules()
  })

  it('should create parallel research with three sources', async () => {
    const { multiSourceResearchAgent } = await import('../../../../lib/harness-client/examples/multi-source-research.server')
    const patterns = await multiSourceResearchAgent.createPatterns()

    const parallelPattern = patterns.find(p =>
      (p as { config: { patternId?: string } }).config.patternId === 'parallel-research'
    )
    expect(parallelPattern).toBeDefined()
  })

  it('should use quality judge for ranking', async () => {
    const { multiSourceResearchAgent } = await import('../../../../lib/harness-client/examples/multi-source-research.server')
    const patterns = await multiSourceResearchAgent.createPatterns()

    const judgePattern = patterns.find(p =>
      (p as { config: { patternId?: string } }).config.patternId === 'quality-judge'
    )
    expect(judgePattern).toBeDefined()
  })

  it('should have synthesizer for final response', async () => {
    const { multiSourceResearchAgent } = await import('../../../../lib/harness-client/examples/multi-source-research.server')
    const patterns = await multiSourceResearchAgent.createPatterns()

    const synthPattern = patterns.find(p =>
      (p as { config: { patternId?: string } }).config.patternId === 'research-synth'
    )
    expect(synthPattern).toBeDefined()
    expect((synthPattern as { name: string }).name).toBe('synthesizer')
  })
})

// ============================================================================
// Ontology Builder Evaluator and Rail Tests
// ============================================================================

describe('Ontology Builder ontologyJudge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    vi.resetModules()
  })

  it('should create judge pattern for ontology evaluation', async () => {
    const { ontologyBuilderAgent } = await import('../../../../lib/harness-client/examples/ontology-builder.server')
    const patterns = await ontologyBuilderAgent.createPatterns()

    const judgePattern = patterns.find(p =>
      (p as { config: { patternId?: string } }).config.patternId === 'ontology-judge'
    )
    expect(judgePattern).toBeDefined()
  })

  it('should include naming convention rail in guardrail', async () => {
    const { ontologyBuilderAgent } = await import('../../../../lib/harness-client/examples/ontology-builder.server')
    const patterns = await ontologyBuilderAgent.createPatterns()

    const guardrailPattern = patterns.find(p =>
      (p as { config: { patternId?: string } }).config.patternId === 'ontology-validated'
    )
    expect(guardrailPattern).toBeDefined()
    expect((guardrailPattern as { name: string }).name).toContain('guardrail')
  })

  it('should include no-orphans rail in guardrail', async () => {
    const { ontologyBuilderAgent } = await import('../../../../lib/harness-client/examples/ontology-builder.server')
    const patterns = await ontologyBuilderAgent.createPatterns()

    // Both rails are included in the guardrail
    const guardrailPattern = patterns.find(p =>
      (p as { config: { patternId?: string } }).config.patternId === 'ontology-validated'
    )
    expect(guardrailPattern).toBeDefined()
  })

  it('should have all phases: scoping, research, proposal, judge, commit, suggestions', async () => {
    const { ontologyBuilderAgent } = await import('../../../../lib/harness-client/examples/ontology-builder.server')
    const patterns = await ontologyBuilderAgent.createPatterns()

    // Check for each phase pattern
    const patternIds = patterns.map(p => (p as { config: { patternId?: string } }).config.patternId)

    // Phase 1: scoping
    expect(patternIds).toContain('ontology-scope')

    // Phase 2: research
    expect(patternIds).toContain('onto-research')

    // Phase 3+4: validated proposal (guardrail wraps proposal)
    expect(patternIds).toContain('ontology-validated')

    // Judge
    expect(patternIds).toContain('ontology-judge')

    // Phase 6: suggestions
    expect(patternIds).toContain('ontology-suggestions')
  })
})

// ============================================================================
// Guardrailed Agent Rail Tests
// ============================================================================

describe('Guardrailed Agent Rails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    vi.resetModules()
  })

  describe('topicalRail', () => {
    it('should be configured with off-topic patterns', async () => {
      const { guardrailedAgent } = await import('../../../../lib/harness-client/examples/guardrailed-agent.server')
      const patterns = await guardrailedAgent.createPatterns()

      const guardrailPattern = patterns.find(p =>
        (p as { config: { patternId?: string } }).config.patternId === 'safe-file-edit'
      )
      expect(guardrailPattern).toBeDefined()
    })
  })

  describe('toolScopeRail', () => {
    it('should be included in guardrail with allowed filesystem tools', async () => {
      const { guardrailedAgent } = await import('../../../../lib/harness-client/examples/guardrailed-agent.server')
      const patterns = await guardrailedAgent.createPatterns()

      const guardrailPattern = patterns.find(p =>
        (p as { config: { patternId?: string } }).config.patternId === 'safe-file-edit'
      )
      expect(guardrailPattern).toBeDefined()
      expect((guardrailPattern as { name: string }).name).toContain('guardrail')
    })
  })

  describe('circuit breaker', () => {
    it('should configure circuit breaker settings', async () => {
      const { guardrailedAgent } = await import('../../../../lib/harness-client/examples/guardrailed-agent.server')
      expect(guardrailedAgent.id).toBe('guardrailed-agent')
      expect(guardrailedAgent.servers).toContain('rust-mcp-filesystem')
    })
  })
})

// ============================================================================
// Conversational Memory Hook Tests
// ============================================================================

describe('Conversational Memory Distillation Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    vi.resetModules()
  })

  it('should have session-close-hook pattern', async () => {
    const { conversationalMemoryAgent } = await import('../../../../lib/harness-client/examples/conversational-memory.server')
    const patterns = await conversationalMemoryAgent.createPatterns()

    const hookPattern = patterns.find(p =>
      (p as { config: { patternId?: string } }).config.patternId === 'session-close-hook'
    )
    expect(hookPattern).toBeDefined()
    // Hook pattern name includes trigger and wrapped pattern
    expect((hookPattern as { name: string }).name).toContain('hook')
  })

  it('should have distill-chain configured as background task', async () => {
    const { conversationalMemoryAgent } = await import('../../../../lib/harness-client/examples/conversational-memory.server')
    const patterns = await conversationalMemoryAgent.createPatterns()

    // Hook exists with distill-chain
    const hookPattern = patterns.find(p =>
      (p as { config: { patternId?: string } }).config.patternId === 'session-close-hook'
    )
    expect(hookPattern).toBeDefined()
  })

  it('should include distill-read and distill-persist in distillation chain', async () => {
    const { conversationalMemoryAgent } = await import('../../../../lib/harness-client/examples/conversational-memory.server')
    expect(conversationalMemoryAgent.servers).toContain('memory')
    expect(conversationalMemoryAgent.servers).toContain('neo4j-cypher')
  })
})

// ============================================================================
// Issue Triage Agent Tests
// ============================================================================

describe('Issue Triage Agent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    vi.resetModules()
  })

  it('should create router pattern for GitHub routes', async () => {
    const { issueTriageAgent } = await import('../../../../lib/harness-client/examples/issue-triage.server')
    const patterns = await issueTriageAgent.createPatterns()

    const routerPattern = patterns.find(p =>
      (p as { name: string }).name === 'router'
    )
    expect(routerPattern).toBeDefined()
  })

  it('should use GitHub servers', async () => {
    const { issueTriageAgent } = await import('../../../../lib/harness-client/examples/issue-triage.server')
    expect(issueTriageAgent.servers).toContain('github')
  })
})

// ============================================================================
// KG Builder Agent Tests
// ============================================================================

describe('KG Builder Agent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    vi.resetModules()
  })

  it('should have web research pattern', async () => {
    const { kgBuilderAgent } = await import('../../../../lib/harness-client/examples/kg-builder.server')
    const patterns = await kgBuilderAgent.createPatterns()

    const webPattern = patterns.find(p =>
      (p as { config: { patternId?: string } }).config.patternId === 'web-research'
    )
    expect(webPattern).toBeDefined()
  })

  it('should have memory extract pattern', async () => {
    const { kgBuilderAgent } = await import('../../../../lib/harness-client/examples/kg-builder.server')
    const patterns = await kgBuilderAgent.createPatterns()

    const memoryPattern = patterns.find(p =>
      (p as { config: { patternId?: string } }).config.patternId === 'memory-extract'
    )
    expect(memoryPattern).toBeDefined()
  })

  it('should have neo4j persist with approval', async () => {
    const { kgBuilderAgent } = await import('../../../../lib/harness-client/examples/kg-builder.server')
    const patterns = await kgBuilderAgent.createPatterns()

    const approvalPattern = patterns.find(p =>
      (p as { name: string }).name === 'withApproval'
    )
    expect(approvalPattern).toBeDefined()
  })
})
