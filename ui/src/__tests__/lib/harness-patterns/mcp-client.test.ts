/**
 * MCP Client Tests
 *
 * Tests for the MCP client module.
 * Note: These tests mock the MCP SDK to avoid actual network calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock server-only imports
vi.mock('../../../lib/harness-patterns/assert.server', () => ({
  assertServerOnImport: vi.fn()
}))

// Mock the MCP SDK
const mockConnect = vi.fn()
const mockClose = vi.fn()
const mockCallTool = vi.fn()
const mockListTools = vi.fn()

class MockClient {
  connect = mockConnect
  close = mockClose
  callTool = mockCallTool
  listTools = mockListTools
}

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: MockClient
}))

class MockTransport {}

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: MockTransport
}))

describe('mcp-client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConnect.mockResolvedValue(undefined)
    mockClose.mockResolvedValue(undefined)
    mockCallTool.mockResolvedValue({
      content: [{ type: 'text', text: '{"result": "success"}' }]
    })
    mockListTools.mockResolvedValue({
      tools: [
        { name: 'test_tool', description: 'A test tool', inputSchema: { type: 'object' } }
      ]
    })
  })

  afterEach(async () => {
    // Reset module state between tests
    vi.resetModules()
  })

  describe('getMcpClient', () => {
    it('should export getMcpClient function', async () => {
      const { getMcpClient } = await import('../../../lib/harness-patterns/mcp-client.server')
      expect(getMcpClient).toBeDefined()
      expect(typeof getMcpClient).toBe('function')
    })

    it('should create and connect a client', async () => {
      const { getMcpClient } = await import('../../../lib/harness-patterns/mcp-client.server')

      const client = await getMcpClient()

      expect(client).toBeDefined()
      expect(mockConnect).toHaveBeenCalled()
    })

    it('should return the same client on subsequent calls', async () => {
      const { getMcpClient } = await import('../../../lib/harness-patterns/mcp-client.server')

      const client1 = await getMcpClient()
      const client2 = await getMcpClient()

      expect(client1).toBe(client2)
      // Connect should only be called once
      expect(mockConnect).toHaveBeenCalledTimes(1)
    })
  })

  describe('callTool', () => {
    it('should export callTool function', async () => {
      const { callTool } = await import('../../../lib/harness-patterns/mcp-client.server')
      expect(callTool).toBeDefined()
      expect(typeof callTool).toBe('function')
    })

    it('should call the tool and return success result', async () => {
      const { callTool } = await import('../../../lib/harness-patterns/mcp-client.server')

      const result = await callTool('test_tool', { arg1: 'value1' })

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ result: 'success' })
    })

    it('should handle non-JSON text content', async () => {
      mockCallTool.mockResolvedValue({
        content: [{ type: 'text', text: 'plain text result' }]
      })

      const { callTool } = await import('../../../lib/harness-patterns/mcp-client.server')

      const result = await callTool('test_tool', {})

      expect(result.success).toBe(true)
      expect(result.data).toBe('plain text result')
    })

    it('should handle structured content', async () => {
      mockCallTool.mockResolvedValue({
        content: [],
        structuredContent: { key: 'value' }
      })

      const { callTool } = await import('../../../lib/harness-patterns/mcp-client.server')

      const result = await callTool('test_tool', {})

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ key: 'value' })
    })

    it('should handle errors gracefully', async () => {
      mockCallTool.mockRejectedValue(new Error('Connection failed'))

      const { callTool } = await import('../../../lib/harness-patterns/mcp-client.server')

      const result = await callTool('test_tool', {})

      expect(result.success).toBe(false)
      expect(result.data).toBeNull()
      expect(result.error).toBe('Connection failed')
    })
  })

  describe('listTools', () => {
    it('should export listTools function', async () => {
      const { listTools } = await import('../../../lib/harness-patterns/mcp-client.server')
      expect(listTools).toBeDefined()
      expect(typeof listTools).toBe('function')
    })

    it('should return list of tool descriptions', async () => {
      const { listTools } = await import('../../../lib/harness-patterns/mcp-client.server')

      const tools = await listTools()

      expect(tools).toHaveLength(1)
      expect(tools[0].name).toBe('test_tool')
      expect(tools[0].description).toBe('A test tool')
    })

    it('should return empty array on error', async () => {
      mockListTools.mockRejectedValue(new Error('Failed'))

      const { listTools } = await import('../../../lib/harness-patterns/mcp-client.server')

      const tools = await listTools()

      expect(tools).toEqual([])
    })
  })

  describe('closeMcpClient', () => {
    it('should export closeMcpClient function', async () => {
      const { closeMcpClient } = await import('../../../lib/harness-patterns/mcp-client.server')
      expect(closeMcpClient).toBeDefined()
      expect(typeof closeMcpClient).toBe('function')
    })

    it('should close the client', async () => {
      const { getMcpClient, closeMcpClient } = await import('../../../lib/harness-patterns/mcp-client.server')

      // First create a client
      await getMcpClient()

      // Then close it
      await closeMcpClient()

      expect(mockClose).toHaveBeenCalled()
    })

    it('should handle close when no client exists', async () => {
      const { closeMcpClient } = await import('../../../lib/harness-patterns/mcp-client.server')

      // Should not throw when no client
      await closeMcpClient()

      // Close shouldn't be called since there's no client
      expect(mockClose).not.toHaveBeenCalled()
    })
  })

  describe('isConnected', () => {
    it('should export isConnected function', async () => {
      const { isConnected } = await import('../../../lib/harness-patterns/mcp-client.server')
      expect(isConnected).toBeDefined()
      expect(typeof isConnected).toBe('function')
    })

    it('should return false when no client', async () => {
      const { isConnected } = await import('../../../lib/harness-patterns/mcp-client.server')

      expect(isConnected()).toBe(false)
    })

    it('should return true after getMcpClient', async () => {
      const { getMcpClient, isConnected } = await import('../../../lib/harness-patterns/mcp-client.server')

      await getMcpClient()

      expect(isConnected()).toBe(true)
    })
  })
})
