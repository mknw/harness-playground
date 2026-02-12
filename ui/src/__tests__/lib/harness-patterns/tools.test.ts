/**
 * Tools Tests
 *
 * Tests for the tools grouping and namespace inference logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock server-only imports
vi.mock('../../../lib/harness-patterns/assert.server', () => ({
  assertServerOnImport: vi.fn()
}))

// Mock MCP client
vi.mock('../../../lib/harness-patterns/mcp-client.server', () => ({
  listTools: vi.fn().mockResolvedValue([])
}))

describe('tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    vi.resetModules()
  })

  describe('ToolsFrom', () => {
    it('should export ToolsFrom function', async () => {
      const { ToolsFrom } = await import('../../../lib/harness-patterns/tools.server')
      expect(ToolsFrom).toBeDefined()
      expect(typeof ToolsFrom).toBe('function')
    })

    it('should group tools by inferred namespace', async () => {
      const { ToolsFrom } = await import('../../../lib/harness-patterns/tools.server')

      const mockTools = [
        { name: 'read_neo4j_cypher', description: 'Read from Neo4j', inputSchema: {} },
        { name: 'write_neo4j_cypher', description: 'Write to Neo4j', inputSchema: {} },
        { name: 'search', description: 'Search the web', inputSchema: {} },
        { name: 'fetch', description: 'Fetch a URL', inputSchema: {} },
      ]

      const tools = ToolsFrom(mockTools)

      expect(tools.neo4j).toContain('read_neo4j_cypher')
      expect(tools.neo4j).toContain('write_neo4j_cypher')
      expect(tools.search).toContain('search')
      expect(tools.fetch).toContain('fetch')
      expect(tools.all).toHaveLength(4)
    })

    it('should return empty all array for no tools', async () => {
      const { ToolsFrom } = await import('../../../lib/harness-patterns/tools.server')

      const tools = ToolsFrom([])

      expect(tools.all).toEqual([])
    })
  })

  describe('inferServer (via ToolsFrom)', () => {
    describe('MCP gateway format (double underscore)', () => {
      it('should handle mcp__server__search → search namespace', async () => {
        const { ToolsFrom } = await import('../../../lib/harness-patterns/tools.server')

        const tools = ToolsFrom([
          { name: 'mcp__kg-agent-mcp-gateway__search', description: 'Search', inputSchema: {} }
        ])

        expect(tools.search).toContain('mcp__kg-agent-mcp-gateway__search')
        expect(tools.mcp).toBeUndefined()
      })

      it('should handle mcp__server__fetch → fetch namespace', async () => {
        const { ToolsFrom } = await import('../../../lib/harness-patterns/tools.server')

        const tools = ToolsFrom([
          { name: 'mcp__kg-agent-mcp-gateway__fetch', description: 'Fetch', inputSchema: {} }
        ])

        expect(tools.fetch).toContain('mcp__kg-agent-mcp-gateway__fetch')
      })

      it('should handle mcp__server__fetch_content → fetch namespace', async () => {
        const { ToolsFrom } = await import('../../../lib/harness-patterns/tools.server')

        const tools = ToolsFrom([
          { name: 'mcp__kg-agent-mcp-gateway__fetch_content', description: 'Fetch content', inputSchema: {} }
        ])

        expect(tools.fetch).toContain('mcp__kg-agent-mcp-gateway__fetch_content')
      })

      it('should handle mcp__server__read_neo4j_cypher → neo4j namespace', async () => {
        const { ToolsFrom } = await import('../../../lib/harness-patterns/tools.server')

        const tools = ToolsFrom([
          { name: 'mcp__kg-agent-mcp-gateway__read_neo4j_cypher', description: 'Read Neo4j', inputSchema: {} }
        ])

        expect(tools.neo4j).toContain('mcp__kg-agent-mcp-gateway__read_neo4j_cypher')
      })

      it('should handle mcp__server__get_neo4j_schema → neo4j namespace', async () => {
        const { ToolsFrom } = await import('../../../lib/harness-patterns/tools.server')

        const tools = ToolsFrom([
          { name: 'mcp__kg-agent-mcp-gateway__get_neo4j_schema', description: 'Get schema', inputSchema: {} }
        ])

        expect(tools.neo4j).toContain('mcp__kg-agent-mcp-gateway__get_neo4j_schema')
      })

      it('should handle mcp__server__mcp-find → mcp namespace', async () => {
        const { ToolsFrom } = await import('../../../lib/harness-patterns/tools.server')

        const tools = ToolsFrom([
          { name: 'mcp__kg-agent-mcp-gateway__mcp-find', description: 'Find MCP', inputSchema: {} }
        ])

        expect(tools.mcp).toContain('mcp__kg-agent-mcp-gateway__mcp-find')
      })
    })

    describe('underscore-separated format', () => {
      it('should handle read_neo4j_cypher → neo4j namespace', async () => {
        const { ToolsFrom } = await import('../../../lib/harness-patterns/tools.server')

        const tools = ToolsFrom([
          { name: 'read_neo4j_cypher', description: 'Read', inputSchema: {} }
        ])

        expect(tools.neo4j).toContain('read_neo4j_cypher')
      })

      it('should handle write_neo4j_cypher → neo4j namespace', async () => {
        const { ToolsFrom } = await import('../../../lib/harness-patterns/tools.server')

        const tools = ToolsFrom([
          { name: 'write_neo4j_cypher', description: 'Write', inputSchema: {} }
        ])

        expect(tools.neo4j).toContain('write_neo4j_cypher')
      })

      it('should handle get_neo4j_schema → neo4j namespace', async () => {
        const { ToolsFrom } = await import('../../../lib/harness-patterns/tools.server')

        const tools = ToolsFrom([
          { name: 'get_neo4j_schema', description: 'Schema', inputSchema: {} }
        ])

        expect(tools.neo4j).toContain('get_neo4j_schema')
      })

      it('should handle web_search → web namespace', async () => {
        const { ToolsFrom } = await import('../../../lib/harness-patterns/tools.server')

        const tools = ToolsFrom([
          { name: 'web_search', description: 'Search', inputSchema: {} }
        ])

        expect(tools.web).toContain('web_search')
      })

      it('should handle fetch_content → fetch namespace (2 parts, no verb skip)', async () => {
        const { ToolsFrom } = await import('../../../lib/harness-patterns/tools.server')

        const tools = ToolsFrom([
          { name: 'fetch_content', description: 'Fetch content', inputSchema: {} }
        ])

        expect(tools.fetch).toContain('fetch_content')
      })

      it('should strip search verb: search_code → code namespace', async () => {
        const { ToolsFrom } = await import('../../../lib/harness-patterns/tools.server')

        const tools = ToolsFrom([
          { name: 'search_code', description: 'Search code', inputSchema: {} }
        ])

        expect(tools.code).toContain('search_code')
        expect(tools.search).toBeUndefined()
      })

      it('should strip search verb: search_issues → issues namespace', async () => {
        const { ToolsFrom } = await import('../../../lib/harness-patterns/tools.server')

        const tools = ToolsFrom([
          { name: 'search_issues', description: 'Search issues', inputSchema: {} }
        ])

        expect(tools.issues).toContain('search_issues')
        expect(tools.search).toBeUndefined()
      })

      it('should strip verb from 2-part names: get_issue → issue namespace', async () => {
        const { ToolsFrom } = await import('../../../lib/harness-patterns/tools.server')

        const tools = ToolsFrom([
          { name: 'get_issue', description: 'Get issue', inputSchema: {} }
        ])

        expect(tools.issue).toContain('get_issue')
        expect(tools.get).toBeUndefined()
      })

      it('should strip verb from 2-part names: list_commits → commits namespace', async () => {
        const { ToolsFrom } = await import('../../../lib/harness-patterns/tools.server')

        const tools = ToolsFrom([
          { name: 'list_commits', description: 'List commits', inputSchema: {} }
        ])

        expect(tools.commits).toContain('list_commits')
        expect(tools.list).toBeUndefined()
      })
    })

    describe('hyphen-separated format', () => {
      it('should handle mcp-find → mcp namespace', async () => {
        const { ToolsFrom } = await import('../../../lib/harness-patterns/tools.server')

        const tools = ToolsFrom([
          { name: 'mcp-find', description: 'Find', inputSchema: {} }
        ])

        expect(tools.mcp).toContain('mcp-find')
      })

      it('should handle mcp-add → mcp namespace', async () => {
        const { ToolsFrom } = await import('../../../lib/harness-patterns/tools.server')

        const tools = ToolsFrom([
          { name: 'mcp-add', description: 'Add', inputSchema: {} }
        ])

        expect(tools.mcp).toContain('mcp-add')
      })
    })

    describe('single word format', () => {
      it('should handle search → search namespace', async () => {
        const { ToolsFrom } = await import('../../../lib/harness-patterns/tools.server')

        const tools = ToolsFrom([
          { name: 'search', description: 'Search', inputSchema: {} }
        ])

        expect(tools.search).toContain('search')
      })

      it('should handle fetch → fetch namespace', async () => {
        const { ToolsFrom } = await import('../../../lib/harness-patterns/tools.server')

        const tools = ToolsFrom([
          { name: 'fetch', description: 'Fetch', inputSchema: {} }
        ])

        expect(tools.fetch).toContain('fetch')
      })
    })

    describe('real-world tool combinations', () => {
      it('should correctly group typical MCP gateway tools', async () => {
        const { ToolsFrom } = await import('../../../lib/harness-patterns/tools.server')

        const tools = ToolsFrom([
          { name: 'mcp__kg-agent-mcp-gateway__search', description: 'Search', inputSchema: {} },
          { name: 'mcp__kg-agent-mcp-gateway__fetch', description: 'Fetch', inputSchema: {} },
          { name: 'mcp__kg-agent-mcp-gateway__fetch_content', description: 'Fetch content', inputSchema: {} },
          { name: 'mcp__kg-agent-mcp-gateway__read_neo4j_cypher', description: 'Read Neo4j', inputSchema: {} },
          { name: 'mcp__kg-agent-mcp-gateway__write_neo4j_cypher', description: 'Write Neo4j', inputSchema: {} },
          { name: 'mcp__kg-agent-mcp-gateway__get_neo4j_schema', description: 'Schema', inputSchema: {} },
        ])

        // Web tools should be grouped correctly
        expect(tools.search).toContain('mcp__kg-agent-mcp-gateway__search')
        expect(tools.fetch).toContain('mcp__kg-agent-mcp-gateway__fetch')
        expect(tools.fetch).toContain('mcp__kg-agent-mcp-gateway__fetch_content')

        // Neo4j tools should be grouped correctly
        expect(tools.neo4j).toContain('mcp__kg-agent-mcp-gateway__read_neo4j_cypher')
        expect(tools.neo4j).toContain('mcp__kg-agent-mcp-gateway__write_neo4j_cypher')
        expect(tools.neo4j).toContain('mcp__kg-agent-mcp-gateway__get_neo4j_schema')

        // Should NOT have 'mcp' namespace from incorrect parsing
        expect(tools.mcp).toBeUndefined()

        // All tools should be in 'all'
        expect(tools.all).toHaveLength(6)
      })

      it('should separate standalone search from search_* tools', async () => {
        const { ToolsFrom } = await import('../../../lib/harness-patterns/tools.server')

        const tools = ToolsFrom([
          { name: 'mcp__kg-agent-mcp-gateway__search', description: 'Search web', inputSchema: {} },
          { name: 'mcp__kg-agent-mcp-gateway__search_code', description: 'Search code', inputSchema: {} },
          { name: 'mcp__kg-agent-mcp-gateway__search_issues', description: 'Search issues', inputSchema: {} },
          { name: 'mcp__kg-agent-mcp-gateway__search_nodes', description: 'Search nodes', inputSchema: {} },
        ])

        // Standalone search → search namespace
        expect(tools.search).toContain('mcp__kg-agent-mcp-gateway__search')
        expect(tools.search).toHaveLength(1)

        // search_code → code namespace
        expect(tools.code).toContain('mcp__kg-agent-mcp-gateway__search_code')

        // search_issues → issues namespace
        expect(tools.issues).toContain('mcp__kg-agent-mcp-gateway__search_issues')

        // search_nodes → nodes namespace
        expect(tools.nodes).toContain('mcp__kg-agent-mcp-gateway__search_nodes')
      })
    })
  })
})
