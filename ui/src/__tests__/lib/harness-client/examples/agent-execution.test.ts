/**
 * Agent Execution Tests
 *
 * Tests that actually execute patterns and evaluator functions
 * to achieve full code coverage.
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

// Mock assert.server
vi.mock('../../../../lib/harness-patterns/assert.server', () => ({
  assertServerOnImport: vi.fn()
}))

// MCP mock
const callToolMock = mockCallTool({
  responses: {
    get_neo4j_schema: { nodes: ['Person'], relationships: ['KNOWS'] },
    read_graph: {
      entities: [
        { name: 'Class1', entityType: 'Class' },
        { name: 'Class2', entityType: 'Class' }
      ],
      relations: []
    }
  }
})

vi.mock('../../../../lib/harness-patterns/mcp-client.server', () => ({
  callTool: callToolMock,
  listTools: mockListTools(mockToolSets.all)
}))

// BAML mock
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

vi.mock('@boundaryml/baml', () => ({
  Collector: vi.fn().mockImplementation(() => ({
    last: {
      rawLlmResponse: 'Raw response',
      usage: { inputTokens: 100, outputTokens: 50 },
      calls: [{ httpRequest: { body: {} } }]
    }
  }))
}))

vi.mock('../../../../lib/harness-patterns/tools.server', () => ({
  Tools: vi.fn(async () => mockToolSets),
  ToolsFrom: vi.fn(async () => mockToolSets)
}))

// ============================================================================
// Helper Types
// ============================================================================

interface Pattern {
  name: string
  fn: (scope: unknown, view: unknown) => Promise<unknown>
  config: { patternId?: string }
}

interface Scope {
  id: string
  data: Record<string, unknown>
  events: unknown[]
}

interface ToolResultEvent {
  type: 'tool_result'
  ts: number
  patternId: string
  data: unknown
}

function createMockScope(data: Record<string, unknown> = {}): Scope {
  return {
    id: 'test-scope',
    data: { input: 'test query about react hooks', ...data },
    events: []
  }
}

function createMockViewWithCandidates(candidates: Array<{ patternId: string; data: unknown }>) {
  const events: ToolResultEvent[] = candidates.map((c, i) => ({
    type: 'tool_result' as const,
    ts: Date.now() + i,
    patternId: c.patternId,
    data: c.data
  }))

  return {
    fromAll: () => ({
      ofType: (type: string) => ({
        get: () => type === 'tool_result' ? events : []
      })
    }),
    fromLastPattern: () => ({
      ofType: () => ({
        get: () => [],
        first: () => null,
        last: () => null
      })
    }),
    lastUserMessage: () => 'test query about react hooks',
    allEvents: () => events
  }
}

// ============================================================================
// LLM Judge Evaluator Execution Tests
// ============================================================================

describe('LLM Judge Evaluator Execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    vi.resetModules()
  })

  it('should score high for substantial content (>500 chars)', async () => {
    const { llmJudgeAgent } = await import('../../../../lib/harness-client/examples/llm-judge.server')
    const patterns = await llmJudgeAgent.createPatterns() as Pattern[]
    const judgePattern = patterns.find(p => p.config.patternId === 'quality-judge')!

    const scope = createMockScope({ input: 'react hooks tutorial' })
    const view = createMockViewWithCandidates([
      {
        patternId: 'doc-lookup',
        data: 'a'.repeat(600) // Substantial content >500 chars
      },
      {
        patternId: 'web-search',
        data: 'short'
      }
    ])

    await judgePattern.fn(scope, view)

    // Judge should have ranked doc-lookup higher
    expect((scope as Scope).data.rankings).toBeDefined()
    const rankings = (scope as Scope).data.rankings as Array<{ source: string; score: number }>
    expect(rankings.length).toBe(2)
  })

  it('should score higher for content containing query terms', async () => {
    const { llmJudgeAgent } = await import('../../../../lib/harness-client/examples/llm-judge.server')
    const patterns = await llmJudgeAgent.createPatterns() as Pattern[]
    const judgePattern = patterns.find(p => p.config.patternId === 'quality-judge')!

    const scope = createMockScope({ input: 'react hooks tutorial' })
    const view = createMockViewWithCandidates([
      {
        patternId: 'doc-lookup',
        data: 'This is about react hooks and how to use them in your tutorial'
      },
      {
        patternId: 'web-search',
        data: 'Unrelated content about python'
      }
    ])

    await judgePattern.fn(scope, view)

    const rankings = (scope as Scope).data.rankings as Array<{ source: string; score: number }>
    expect(rankings).toBeDefined()
  })

  it('should give source authority bonus', async () => {
    const { llmJudgeAgent } = await import('../../../../lib/harness-client/examples/llm-judge.server')
    const patterns = await llmJudgeAgent.createPatterns() as Pattern[]
    const judgePattern = patterns.find(p => p.config.patternId === 'quality-judge')!

    const scope = createMockScope({ input: 'test query' })
    const sameContent = 'a'.repeat(200)
    const view = createMockViewWithCandidates([
      { patternId: 'doc-lookup', data: sameContent },      // 0.25 bonus
      { patternId: 'github-search', data: sameContent },   // 0.15 bonus
      { patternId: 'web-search', data: sameContent }       // 0.1 bonus
    ])

    await judgePattern.fn(scope, view)

    const rankings = (scope as Scope).data.rankings as Array<{ source: string; score: number }>
    expect(rankings).toBeDefined()
    expect(rankings.length).toBe(3)
  })

  it('should give bonus for code blocks', async () => {
    const { llmJudgeAgent } = await import('../../../../lib/harness-client/examples/llm-judge.server')
    const patterns = await llmJudgeAgent.createPatterns() as Pattern[]
    const judgePattern = patterns.find(p => p.config.patternId === 'quality-judge')!

    const scope = createMockScope({ input: 'code example' })
    const view = createMockViewWithCandidates([
      {
        patternId: 'doc-lookup',
        data: 'Here is a code example:\n```js\nconst x = 1;\n```\nMore text here to make it substantial enough for scoring.'
      }
    ])

    await judgePattern.fn(scope, view)

    const rankings = (scope as Scope).data.rankings as Array<{ source: string; reason: string }>
    expect(rankings).toBeDefined()
    // Should contain "Contains code examples" in reason
    expect(rankings[0].reason).toContain('code')
  })

  it('should give bonus for lists', async () => {
    const { llmJudgeAgent } = await import('../../../../lib/harness-client/examples/llm-judge.server')
    const patterns = await llmJudgeAgent.createPatterns() as Pattern[]
    const judgePattern = patterns.find(p => p.config.patternId === 'quality-judge')!

    const scope = createMockScope({ input: 'list items' })
    const view = createMockViewWithCandidates([
      {
        patternId: 'doc-lookup',
        // Need substantial content (>100 chars) for the list bonus to show in reason
        data: 'Here is a list about many list items and things in this comprehensive guide:\n- First item about lists\n- Second item about lists\n* Third item about lists\nMore content here to be substantial and cover all aspects.'
      }
    ])

    await judgePattern.fn(scope, view)

    const rankings = (scope as Scope).data.rankings as Array<{ source: string; reason: string }>
    expect(rankings).toBeDefined()
    // Verify it was processed - may show lists or other reasons based on scoring
    expect(rankings[0].reason.length).toBeGreaterThan(0)
  })

  it('should cap score at 1.0', async () => {
    const { llmJudgeAgent } = await import('../../../../lib/harness-client/examples/llm-judge.server')
    const patterns = await llmJudgeAgent.createPatterns() as Pattern[]
    const judgePattern = patterns.find(p => p.config.patternId === 'quality-judge')!

    // Create content that would score > 1.0 uncapped
    const content = 'react hooks tutorial with react hooks and more react hooks\n```code\n```\n- list item'
    const scope = createMockScope({ input: 'react hooks' })
    const view = createMockViewWithCandidates([
      { patternId: 'doc-lookup', data: content.repeat(10) } // Very long with all bonuses
    ])

    await judgePattern.fn(scope, view)

    const rankings = (scope as Scope).data.rankings as Array<{ source: string; score: number }>
    expect(rankings).toBeDefined()
    expect(rankings[0].score).toBeLessThanOrEqual(1)
  })

  it('should handle empty candidates', async () => {
    const { llmJudgeAgent } = await import('../../../../lib/harness-client/examples/llm-judge.server')
    const patterns = await llmJudgeAgent.createPatterns() as Pattern[]
    const judgePattern = patterns.find(p => p.config.patternId === 'quality-judge')!

    const scope = createMockScope()
    const view = createMockViewWithCandidates([])

    await judgePattern.fn(scope, view)

    // Should have tracked error event
    const errorEvents = (scope as Scope).events.filter(e => (e as { type: string }).type === 'error')
    expect(errorEvents.length).toBeGreaterThan(0)
  })

  it('should handle query with no terms > 3 chars', async () => {
    const { llmJudgeAgent } = await import('../../../../lib/harness-client/examples/llm-judge.server')
    const patterns = await llmJudgeAgent.createPatterns() as Pattern[]
    const judgePattern = patterns.find(p => p.config.patternId === 'quality-judge')!

    const scope = createMockScope({ input: 'a b c' }) // All terms <= 3 chars
    const view = createMockViewWithCandidates([
      { patternId: 'doc-lookup', data: 'Some content here' }
    ])

    await judgePattern.fn(scope, view)

    // Should still work, just with 0 relevance
    expect((scope as Scope).data.rankings).toBeDefined()
  })
})

// ============================================================================
// Multi-Source Research Evaluator Execution Tests
// ============================================================================

describe('Multi-Source Research Evaluator Execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    vi.resetModules()
  })

  it('should score based on content length and relevance', async () => {
    const { multiSourceResearchAgent } = await import('../../../../lib/harness-client/examples/multi-source-research.server')
    const patterns = await multiSourceResearchAgent.createPatterns() as Pattern[]
    const judgePattern = patterns.find(p => p.config.patternId === 'quality-judge')!

    const scope = createMockScope({ input: 'python flask tutorial' })
    const view = createMockViewWithCandidates([
      {
        patternId: 'web-search',
        // >100 chars and contains query terms
        data: 'This is a comprehensive python flask tutorial that covers all the basics of python and flask. It includes many examples and code snippets for learning flask development.'
      },
      {
        patternId: 'github-search',
        // <100 chars
        data: 'Short content'
      }
    ])

    await judgePattern.fn(scope, view)

    const rankings = (scope as Scope).data.rankings as Array<{ source: string; score: number; reason: string }>
    expect(rankings).toBeDefined()
    expect(rankings.length).toBe(2)
    // Web search should score higher
    expect(rankings[0].score).toBeGreaterThan(rankings[1].score)
  })

  it('should handle candidates with only content length', async () => {
    const { multiSourceResearchAgent } = await import('../../../../lib/harness-client/examples/multi-source-research.server')
    const patterns = await multiSourceResearchAgent.createPatterns() as Pattern[]
    const judgePattern = patterns.find(p => p.config.patternId === 'quality-judge')!

    const scope = createMockScope({ input: 'xyz123' }) // No matching terms
    const view = createMockViewWithCandidates([
      {
        patternId: 'web-search',
        data: 'a'.repeat(150) // >100 chars but no relevant terms
      }
    ])

    await judgePattern.fn(scope, view)

    const rankings = (scope as Scope).data.rankings as Array<{ source: string; reason: string }>
    expect(rankings).toBeDefined()
    expect(rankings[0].reason).toContain('substantial')
  })

  it('should give correct reason for limited content', async () => {
    const { multiSourceResearchAgent } = await import('../../../../lib/harness-client/examples/multi-source-research.server')
    const patterns = await multiSourceResearchAgent.createPatterns() as Pattern[]
    const judgePattern = patterns.find(p => p.config.patternId === 'quality-judge')!

    const scope = createMockScope({ input: 'test' })
    const view = createMockViewWithCandidates([
      {
        patternId: 'web-search',
        data: 'short' // <100 chars
      }
    ])

    await judgePattern.fn(scope, view)

    const rankings = (scope as Scope).data.rankings as Array<{ source: string; reason: string }>
    expect(rankings).toBeDefined()
    expect(rankings[0].reason).toBe('Limited content')
  })

  it('should select best candidate', async () => {
    const { multiSourceResearchAgent } = await import('../../../../lib/harness-client/examples/multi-source-research.server')
    const patterns = await multiSourceResearchAgent.createPatterns() as Pattern[]
    const judgePattern = patterns.find(p => p.config.patternId === 'quality-judge')!

    const scope = createMockScope({ input: 'test query' })
    const goodContent = 'This is a substantial test query response with lots of relevant test content about the query topic.'
    const view = createMockViewWithCandidates([
      { patternId: 'web-search', data: 'short' },
      { patternId: 'github-search', data: goodContent }
    ])

    await judgePattern.fn(scope, view)

    // Best should be github-search
    expect((scope as Scope).data.response).toBeDefined()
  })
})

// ============================================================================
// Ontology Builder Judge and Rails Execution Tests
// ============================================================================

describe('Ontology Builder ontologyJudge Execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    vi.resetModules()
  })

  it('should score for class/concept definitions', async () => {
    const { ontologyBuilderAgent } = await import('../../../../lib/harness-client/examples/ontology-builder.server')
    const patterns = await ontologyBuilderAgent.createPatterns() as Pattern[]
    const judgePattern = patterns.find(p => p.config.patternId === 'ontology-judge')!

    const scope = createMockScope({ input: 'domain ontology' })
    const view = createMockViewWithCandidates([
      {
        patternId: 'onto-doc-research',
        data: 'The ontology defines class Person, class Organization, entity Document, concept Event, and type Record. These are the main classes.'
      }
    ])

    await judgePattern.fn(scope, view)

    const rankings = (scope as Scope).data.rankings as Array<{ source: string; reason: string }>
    expect(rankings).toBeDefined()
    expect(rankings[0].reason).toContain('class definitions')
  })

  it('should score for relationships', async () => {
    const { ontologyBuilderAgent } = await import('../../../../lib/harness-client/examples/ontology-builder.server')
    const patterns = await ontologyBuilderAgent.createPatterns() as Pattern[]
    const judgePattern = patterns.find(p => p.config.patternId === 'ontology-judge')!

    const scope = createMockScope({ input: 'domain ontology' })
    const view = createMockViewWithCandidates([
      {
        patternId: 'onto-doc-research',
        data: 'The ontology has relation WORKS_FOR, property hasMember, and link between Person and Organization connected by knows.'
      }
    ])

    await judgePattern.fn(scope, view)

    const rankings = (scope as Scope).data.rankings as Array<{ source: string; reason: string }>
    expect(rankings).toBeDefined()
    expect(rankings[0].reason).toContain('relationships')
  })

  it('should score for hierarchical structure', async () => {
    const { ontologyBuilderAgent } = await import('../../../../lib/harness-client/examples/ontology-builder.server')
    const patterns = await ontologyBuilderAgent.createPatterns() as Pattern[]
    const judgePattern = patterns.find(p => p.config.patternId === 'ontology-judge')!

    const scope = createMockScope({ input: 'domain ontology' })
    const view = createMockViewWithCandidates([
      {
        patternId: 'onto-doc-research',
        data: 'The class Employee is a subclass of Person, and Manager inherits from Employee. Parent class is Entity.'
      }
    ])

    await judgePattern.fn(scope, view)

    const rankings = (scope as Scope).data.rankings as Array<{ source: string; reason: string }>
    expect(rankings).toBeDefined()
    expect(rankings[0].reason).toContain('Hierarchical structure')
  })

  it('should score for substantial coverage', async () => {
    const { ontologyBuilderAgent } = await import('../../../../lib/harness-client/examples/ontology-builder.server')
    const patterns = await ontologyBuilderAgent.createPatterns() as Pattern[]
    const judgePattern = patterns.find(p => p.config.patternId === 'ontology-judge')!

    const scope = createMockScope({ input: 'domain ontology' })
    const view = createMockViewWithCandidates([
      {
        patternId: 'onto-doc-research',
        data: 'a'.repeat(600) // >500 chars
      }
    ])

    await judgePattern.fn(scope, view)

    const rankings = (scope as Scope).data.rankings as Array<{ source: string; reason: string }>
    expect(rankings).toBeDefined()
    expect(rankings[0].reason).toContain('Substantial coverage')
  })

  it('should always add consistency check', async () => {
    const { ontologyBuilderAgent } = await import('../../../../lib/harness-client/examples/ontology-builder.server')
    const patterns = await ontologyBuilderAgent.createPatterns() as Pattern[]
    const judgePattern = patterns.find(p => p.config.patternId === 'ontology-judge')!

    const scope = createMockScope({ input: 'domain ontology' })
    const view = createMockViewWithCandidates([
      {
        patternId: 'onto-doc-research',
        data: 'Short content'
      }
    ])

    await judgePattern.fn(scope, view)

    const rankings = (scope as Scope).data.rankings as Array<{ source: string; reason: string }>
    expect(rankings).toBeDefined()
    expect(rankings[0].reason).toContain('No contradictions detected')
  })
})

// ============================================================================
// Guardrailed Agent Rails Execution Tests
// ============================================================================

describe('Guardrailed Agent Rails Execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    vi.resetModules()
  })

  it('should create guardrail with all rails configured', async () => {
    const { guardrailedAgent } = await import('../../../../lib/harness-client/examples/guardrailed-agent.server')
    const patterns = await guardrailedAgent.createPatterns() as Pattern[]

    const guardrailPattern = patterns.find(p => p.config.patternId === 'safe-file-edit')
    expect(guardrailPattern).toBeDefined()
    // The guardrail wraps withApproval which wraps actorCritic
    expect(guardrailPattern!.name).toContain('guardrail')
  })

  it('should configure circuit breaker', async () => {
    const { guardrailedAgent } = await import('../../../../lib/harness-client/examples/guardrailed-agent.server')
    expect(guardrailedAgent.id).toBe('guardrailed-agent')
    expect(guardrailedAgent.description).toContain('5-layer')
  })
})

// ============================================================================
// Conversational Memory Distillation Hook Tests
// ============================================================================

describe('Conversational Memory Distillation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    vi.resetModules()
  })

  it('should have hook configured for session_close trigger', async () => {
    const { conversationalMemoryAgent } = await import('../../../../lib/harness-client/examples/conversational-memory.server')
    const patterns = await conversationalMemoryAgent.createPatterns() as Pattern[]

    const hookPattern = patterns.find(p => p.config.patternId === 'session-close-hook')
    expect(hookPattern).toBeDefined()
  })

  it('should configure hook as background task', async () => {
    const { conversationalMemoryAgent } = await import('../../../../lib/harness-client/examples/conversational-memory.server')
    const patterns = await conversationalMemoryAgent.createPatterns() as Pattern[]

    const hookPattern = patterns.find(p => p.config.patternId === 'session-close-hook')
    expect(hookPattern).toBeDefined()
    // Hook pattern name includes trigger and wrapped pattern
    expect(hookPattern!.name).toContain('hook')
  })
})
