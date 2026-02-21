/**
 * Router Pattern Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock server-only imports
vi.mock('../../../lib/harness-patterns/assert.server', () => ({
  assertServerOnImport: vi.fn()
}))

// Mock routing
const mockRouteMessageOp = vi.fn()
vi.mock('../../../lib/harness-patterns/routing.server', () => ({
  routeMessageOp: (...args: unknown[]) => mockRouteMessageOp(...args)
}))

describe('router', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRouteMessageOp.mockResolvedValue({
      intent: 'Test intent',
      tool_call_needed: true,
      tool_name: 'neo4j',
      response_text: ''
    })
  })

  it('should export router function', async () => {
    const { router } = await import('../../../lib/harness-patterns/router.server')
    expect(router).toBeDefined()
    expect(typeof router).toBe('function')
  })

  it('should create a ConfiguredPattern', async () => {
    const { router } = await import('../../../lib/harness-patterns/router.server')

    const routes = {
      neo4j: 'Database queries',
      web: 'Web search'
    }

    const patterns = {
      neo4j: { name: 'neo4j-loop', fn: vi.fn(), config: { patternId: 'neo4j' } },
      web: { name: 'web-loop', fn: vi.fn(), config: { patternId: 'web' } }
    }

    const pattern = router(routes, patterns)

    expect(pattern.name).toBe('router')
    expect(pattern.fn).toBeDefined()
  })

  it('should dispatch to correct pattern based on route', async () => {
    const { router } = await import('../../../lib/harness-patterns/router.server')
    const { createContext } = await import('../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../lib/harness-patterns/patterns/event-view.server')

    const neo4jFn = vi.fn(async (scope) => {
      scope.data = { ...scope.data, response: 'Neo4j result' }
      return scope
    })

    const webFn = vi.fn(async (scope) => scope)

    const routes = {
      neo4j: 'Database queries',
      web: 'Web search'
    }

    const patterns = {
      neo4j: { name: 'neo4j-loop', fn: neo4jFn, config: { patternId: 'neo4j' } },
      web: { name: 'web-loop', fn: webFn, config: { patternId: 'web' } }
    }

    mockRouteMessageOp.mockResolvedValue({
      intent: 'Query database',
      tool_call_needed: true,
      tool_name: 'neo4j',
      response_text: ''
    })

    const ctx = createContext<{ response?: string }>('test')
    ctx.events.push({
      type: 'user_message',
      ts: Date.now(),
      patternId: 'router',
      data: { content: 'Query the database' }
    })
    const view = createEventView(ctx)

    const pattern = router(routes, patterns)
    await pattern.fn(
      { id: 'router', data: ctx.data, events: [], startTime: Date.now() },
      view
    )

    expect(neo4jFn).toHaveBeenCalled()
    expect(webFn).not.toHaveBeenCalled()
  })

  it('should return conversational response when no tool needed', async () => {
    const { router } = await import('../../../lib/harness-patterns/router.server')
    const { createContext } = await import('../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../lib/harness-patterns/patterns/event-view.server')

    const routes = { neo4j: 'Database queries' }
    const patterns = {
      neo4j: { name: 'neo4j-loop', fn: vi.fn(), config: { patternId: 'neo4j' } }
    }

    mockRouteMessageOp.mockResolvedValue({
      intent: 'Greeting',
      tool_call_needed: false,
      tool_name: null,
      response_text: 'Hello! How can I help you?'
    })

    const ctx = createContext<{ response?: string; routerResponse?: string }>('test')
    ctx.events.push({
      type: 'user_message',
      ts: Date.now(),
      patternId: 'router',
      data: { content: 'Hello' }
    })
    const view = createEventView(ctx)

    const pattern = router(routes, patterns)
    const result = await pattern.fn(
      { id: 'router', data: ctx.data, events: [], startTime: Date.now() },
      view
    )

    expect(result.data.response).toBe('Hello! How can I help you?')
    expect(patterns.neo4j.fn).not.toHaveBeenCalled()
  })

  it('should track error when route not found', async () => {
    const { router } = await import('../../../lib/harness-patterns/router.server')
    const { createContext } = await import('../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../lib/harness-patterns/patterns/event-view.server')

    const routes = { neo4j: 'Database queries' }
    const patterns = {
      neo4j: { name: 'neo4j-loop', fn: vi.fn(), config: { patternId: 'neo4j' } }
    }

    mockRouteMessageOp.mockResolvedValue({
      intent: 'Unknown',
      tool_call_needed: true,
      tool_name: 'unknown_route',
      response_text: ''
    })

    const ctx = createContext('test')
    ctx.events.push({
      type: 'user_message',
      ts: Date.now(),
      patternId: 'router',
      data: { content: 'Do something' }
    })
    const view = createEventView(ctx)

    const pattern = router(routes, patterns)
    const result = await pattern.fn(
      { id: 'router', data: ctx.data, events: [], startTime: Date.now() },
      view
    )

    const errorEvents = result.events.filter(e => e.type === 'error')
    expect(errorEvents.length).toBeGreaterThan(0)
    expect(JSON.stringify(errorEvents[0].data)).toContain('No pattern registered')
  })

  it('should track error when tool_call_needed but no tool_name', async () => {
    const { router } = await import('../../../lib/harness-patterns/router.server')
    const { createContext } = await import('../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../lib/harness-patterns/patterns/event-view.server')

    const routes = { neo4j: 'Database queries' }
    const patterns = {
      neo4j: { name: 'neo4j-loop', fn: vi.fn(), config: { patternId: 'neo4j' } }
    }

    mockRouteMessageOp.mockResolvedValue({
      intent: 'Ambiguous',
      tool_call_needed: true,
      tool_name: null,
      response_text: ''
    })

    const ctx = createContext('test')
    ctx.events.push({
      type: 'user_message',
      ts: Date.now(),
      patternId: 'router',
      data: { content: 'Do something' }
    })
    const view = createEventView(ctx)

    const pattern = router(routes, patterns)
    const result = await pattern.fn(
      { id: 'router', data: ctx.data, events: [], startTime: Date.now() },
      view
    )

    const errorEvents = result.events.filter(e => e.type === 'error')
    expect(errorEvents.length).toBeGreaterThan(0)
    expect(JSON.stringify(errorEvents[0].data)).toContain('tool_call_needed but no tool_name')
  })

  it('should keep pattern response without prepending router status', async () => {
    const { router } = await import('../../../lib/harness-patterns/router.server')
    const { createContext } = await import('../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../lib/harness-patterns/patterns/event-view.server')

    const routes = { neo4j: 'Database queries' }
    const patterns = {
      neo4j: {
        name: 'neo4j-loop',
        fn: vi.fn(async (scope) => {
          scope.data = { ...scope.data, response: 'Pattern response' }
          return scope
        }),
        config: { patternId: 'neo4j' }
      }
    }

    mockRouteMessageOp.mockResolvedValue({
      intent: 'Query',
      tool_call_needed: true,
      tool_name: 'neo4j',
      response_text: 'Looking into that...'
    })

    const ctx = createContext<{ response?: string }>('test')
    ctx.events.push({
      type: 'user_message',
      ts: Date.now(),
      patternId: 'router',
      data: { content: 'Query' }
    })
    const view = createEventView(ctx)

    const pattern = router(routes, patterns)
    const scope = { id: 'router', data: ctx.data, events: [] as any[], startTime: Date.now() }
    const result = await pattern.fn(scope, view)

    // Pattern response should not have router status prepended
    expect(result.data.response).toBe('Pattern response')
    // Router status tracked as separate assistant_message event
    const assistantEvents = result.events.filter((e: any) => e.type === 'assistant_message')
    expect(assistantEvents.length).toBeGreaterThan(0)
    expect((assistantEvents[0].data as any).content).toBe('Looking into that...')
  })

  it('should merge events from executed pattern', async () => {
    const { router } = await import('../../../lib/harness-patterns/router.server')
    const { createContext } = await import('../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../lib/harness-patterns/patterns/event-view.server')

    const routes = { neo4j: 'Database queries' }
    const patterns = {
      neo4j: {
        name: 'neo4j-loop',
        fn: vi.fn(async (scope) => {
          scope.events.push({
            type: 'tool_call' as const,
            ts: Date.now(),
            patternId: 'neo4j',
            data: { tool: 'test' }
          })
          return scope
        }),
        config: { patternId: 'neo4j' }
      }
    }

    mockRouteMessageOp.mockResolvedValue({
      intent: 'Query',
      tool_call_needed: true,
      tool_name: 'neo4j',
      response_text: ''
    })

    const ctx = createContext('test')
    ctx.events.push({
      type: 'user_message',
      ts: Date.now(),
      patternId: 'router',
      data: { content: 'Query' }
    })
    const view = createEventView(ctx)

    const pattern = router(routes, patterns)
    const result = await pattern.fn(
      { id: 'router', data: ctx.data, events: [], startTime: Date.now() },
      view
    )

    const toolCalls = result.events.filter(e => e.type === 'tool_call')
    expect(toolCalls.length).toBeGreaterThan(0)
  })

  it('should handle errors gracefully', async () => {
    const { router } = await import('../../../lib/harness-patterns/router.server')
    const { createContext } = await import('../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../lib/harness-patterns/patterns/event-view.server')

    const routes = { neo4j: 'Database queries' }
    const patterns = {
      neo4j: { name: 'neo4j-loop', fn: vi.fn(), config: { patternId: 'neo4j' } }
    }

    mockRouteMessageOp.mockRejectedValue(new Error('Routing failed'))

    const ctx = createContext('test')
    ctx.events.push({
      type: 'user_message',
      ts: Date.now(),
      patternId: 'router',
      data: { content: 'Query' }
    })
    const view = createEventView(ctx)

    const pattern = router(routes, patterns)
    const result = await pattern.fn(
      { id: 'router', data: ctx.data, events: [], startTime: Date.now() },
      view
    )

    const errorEvents = result.events.filter(e => e.type === 'error')
    expect(errorEvents.length).toBeGreaterThan(0)
    expect(JSON.stringify(errorEvents[0].data)).toContain('Routing failed')
  })

  it('should update scope data with routing info', async () => {
    const { router } = await import('../../../lib/harness-patterns/router.server')
    const { createContext } = await import('../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../lib/harness-patterns/patterns/event-view.server')

    const routes = { neo4j: 'Database queries' }
    const patterns = {
      neo4j: {
        name: 'neo4j-loop',
        fn: vi.fn(async (scope) => scope),
        config: { patternId: 'neo4j' }
      }
    }

    mockRouteMessageOp.mockResolvedValue({
      intent: 'Database query intent',
      tool_call_needed: true,
      tool_name: 'neo4j',
      response_text: 'Router response'
    })

    const ctx = createContext<{ route?: string; intent?: string; routerResponse?: string }>('test')
    ctx.events.push({
      type: 'user_message',
      ts: Date.now(),
      patternId: 'router',
      data: { content: 'Query' }
    })
    const view = createEventView(ctx)

    const pattern = router(routes, patterns)
    const result = await pattern.fn(
      { id: 'router', data: ctx.data, events: [], startTime: Date.now() },
      view
    )

    expect(result.data.route).toBe('neo4j')
    expect(result.data.intent).toBe('Database query intent')
    expect(result.data.routerResponse).toBe('Router response')
  })
})
