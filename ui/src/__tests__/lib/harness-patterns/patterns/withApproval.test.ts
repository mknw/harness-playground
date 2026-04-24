/**
 * withApproval Pattern Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock server-only imports
vi.mock('../../../../lib/harness-patterns/assert.server', () => ({
  assertServerOnImport: vi.fn()
}))

describe('withApproval', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should export withApproval function', async () => {
    const { withApproval } = await import('../../../../lib/harness-patterns/patterns/withApproval.server')
    expect(withApproval).toBeDefined()
    expect(typeof withApproval).toBe('function')
  })

  it('should create a ConfiguredPattern', async () => {
    const { withApproval } = await import('../../../../lib/harness-patterns/patterns/withApproval.server')

    const innerPattern = {
      name: 'inner',
      fn: vi.fn(async (scope) => scope),
      config: { patternId: 'inner' }
    }

    const pattern = withApproval(innerPattern, () => true, { patternId: 'approval-test' })

    expect(pattern.name).toBe('withApproval')
    expect(pattern.fn).toBeDefined()
  })

  it('should execute inner pattern normally when action does not need approval', async () => {
    const { withApproval } = await import('../../../../lib/harness-patterns/patterns/withApproval.server')
    const { createContext } = await import('../../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../../lib/harness-patterns/patterns/event-view.server')

    const innerFn = vi.fn(async (scope) => {
      scope.data = { ...scope.data, executed: true }
      return scope
    })

    const innerPattern = {
      name: 'inner',
      fn: innerFn,
      config: { patternId: 'inner' }
    }

    // Predicate that never needs approval
    const predicate = vi.fn().mockReturnValue(false)

    const ctx = createContext<{ executed?: boolean; lastAction?: unknown }>('test')
    const view = createEventView(ctx)

    const pattern = withApproval(innerPattern, predicate)
    const result = await pattern.fn(
      { id: 'approval', data: ctx.data, events: [], startTime: Date.now() },
      view
    )

    expect(innerFn).toHaveBeenCalled()
    expect(result.data.executed).toBe(true)
  })

  it('should set pendingAction when action needs approval', async () => {
    const { withApproval } = await import('../../../../lib/harness-patterns/patterns/withApproval.server')
    const { createContext } = await import('../../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../../lib/harness-patterns/patterns/event-view.server')

    const innerFn = vi.fn(async (scope) => {
      scope.data = {
        ...scope.data,
        lastAction: {
          tool_name: 'write_neo4j_cypher',
          tool_args: '{"query": "CREATE (n:Node)"}',
          status: 'pending'
        }
      }
      return scope
    })

    const innerPattern = {
      name: 'inner',
      fn: innerFn,
      config: { patternId: 'inner' }
    }

    // Predicate that requires approval for writes
    const predicate = vi.fn().mockReturnValue(true)

    const ctx = createContext<{
      lastAction?: { tool_name: string; tool_args: string; status: string }
      pendingAction?: unknown
    }>('test')
    const view = createEventView(ctx)

    const pattern = withApproval(innerPattern, predicate)
    const result = await pattern.fn(
      { id: 'approval', data: ctx.data, events: [], startTime: Date.now() },
      view
    )

    expect(result.data.pendingAction).toBeDefined()
    expect((result.data.pendingAction as { action: string }).action).toBe('write_neo4j_cypher')
  })

  it('should continue execution when resumed with approval', async () => {
    const { withApproval } = await import('../../../../lib/harness-patterns/patterns/withApproval.server')
    const { createContext } = await import('../../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../../lib/harness-patterns/patterns/event-view.server')

    const innerFn = vi.fn(async (scope) => {
      scope.data = { ...scope.data, executed: true }
      return scope
    })

    const innerPattern = {
      name: 'inner',
      fn: innerFn,
      config: { patternId: 'inner' }
    }

    // Create context with pending action and approval
    const ctx = createContext<{
      pendingAction?: unknown
      approved?: boolean
      executed?: boolean
    }>('test')
    ctx.data = {
      pendingAction: { action: 'write', payload: '{}', reason: 'test' },
      approved: true
    }
    const view = createEventView(ctx)

    const pattern = withApproval(innerPattern, () => true)
    const result = await pattern.fn(
      { id: 'approval', data: ctx.data, events: [], startTime: Date.now() },
      view
    )

    // Should have cleared pending action
    expect(result.data.pendingAction).toBeUndefined()
    expect(result.data.approved).toBeUndefined()
  })

  it('should cancel and return message when resumed without approval', async () => {
    const { withApproval } = await import('../../../../lib/harness-patterns/patterns/withApproval.server')
    const { createContext } = await import('../../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../../lib/harness-patterns/patterns/event-view.server')

    const innerFn = vi.fn(async (scope) => scope)
    const innerPattern = {
      name: 'inner',
      fn: innerFn,
      config: { patternId: 'inner' }
    }

    // Create context with pending action and rejection
    const ctx = createContext<{
      pendingAction?: unknown
      approved?: boolean
      response?: string
    }>('test')
    ctx.data = {
      pendingAction: { action: 'write', payload: '{}', reason: 'test' },
      approved: false
    }
    const view = createEventView(ctx)

    const pattern = withApproval(innerPattern, () => true)
    const result = await pattern.fn(
      { id: 'approval', data: ctx.data, events: [], startTime: Date.now() },
      view
    )

    expect(result.data.response).toBe('Operation cancelled by user.')
    expect(innerFn).not.toHaveBeenCalled()
  })

  it('should handle errors gracefully', async () => {
    const { withApproval } = await import('../../../../lib/harness-patterns/patterns/withApproval.server')
    const { createContext } = await import('../../../../lib/harness-patterns/context.server')
    const { createEventView } = await import('../../../../lib/harness-patterns/patterns/event-view.server')

    const innerPattern = {
      name: 'inner',
      fn: vi.fn().mockRejectedValue(new Error('Inner failed')),
      config: { patternId: 'inner' }
    }

    const ctx = createContext('test')
    const view = createEventView(ctx)

    const pattern = withApproval(innerPattern, () => false)
    const result = await pattern.fn(
      { id: 'approval', data: ctx.data, events: [], startTime: Date.now() },
      view
    )

    const errorEvents = result.events.filter(e => e.type === 'error')
    expect(errorEvents.length).toBeGreaterThan(0)
    expect(JSON.stringify(errorEvents[0].data)).toContain('Inner failed')
  })
})

describe('approvalPredicates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should export approvalPredicates', async () => {
    const { approvalPredicates } = await import('../../../../lib/harness-patterns/patterns/withApproval.server')
    expect(approvalPredicates).toBeDefined()
  })

  describe('writes predicate', () => {
    it('should return true for write operations', async () => {
      const { approvalPredicates } = await import('../../../../lib/harness-patterns/patterns/withApproval.server')

      expect(approvalPredicates.writes({
        tool_name: 'write_neo4j_cypher',
        tool_args: '{}',
        reasoning: '',
        status: '',
        is_final: false
      })).toBe(true)

      expect(approvalPredicates.writes({
        tool_name: 'WriteFile',
        tool_args: '{}',
        reasoning: '',
        status: '',
        is_final: false
      })).toBe(true)
    })

    it('should return false for non-write operations', async () => {
      const { approvalPredicates } = await import('../../../../lib/harness-patterns/patterns/withApproval.server')

      expect(approvalPredicates.writes({
        tool_name: 'read_neo4j_cypher',
        tool_args: '{}',
        reasoning: '',
        status: '',
        is_final: false
      })).toBe(false)
    })
  })

  describe('deletes predicate', () => {
    it('should return true for delete operations', async () => {
      const { approvalPredicates } = await import('../../../../lib/harness-patterns/patterns/withApproval.server')

      expect(approvalPredicates.deletes({
        tool_name: 'delete_entities',
        tool_args: '{}',
        reasoning: '',
        status: '',
        is_final: false
      })).toBe(true)

      expect(approvalPredicates.deletes({
        tool_name: 'DeleteFile',
        tool_args: '{}',
        reasoning: '',
        status: '',
        is_final: false
      })).toBe(true)
    })

    it('should return false for non-delete operations', async () => {
      const { approvalPredicates } = await import('../../../../lib/harness-patterns/patterns/withApproval.server')

      expect(approvalPredicates.deletes({
        tool_name: 'read_file',
        tool_args: '{}',
        reasoning: '',
        status: '',
        is_final: false
      })).toBe(false)
    })
  })

  describe('mutations predicate', () => {
    it('should return true for mutation operations', async () => {
      const { approvalPredicates } = await import('../../../../lib/harness-patterns/patterns/withApproval.server')

      const mutations = ['write', 'delete', 'create', 'update', 'insert', 'remove']

      for (const mutation of mutations) {
        expect(approvalPredicates.mutations({
          tool_name: `${mutation}_something`,
          tool_args: '{}',
          reasoning: '',
          status: '',
          is_final: false
        })).toBe(true)
      }
    })

    it('should return false for read operations', async () => {
      const { approvalPredicates } = await import('../../../../lib/harness-patterns/patterns/withApproval.server')

      expect(approvalPredicates.mutations({
        tool_name: 'read_file',
        tool_args: '{}',
        reasoning: '',
        status: '',
        is_final: false
      })).toBe(false)

      expect(approvalPredicates.mutations({
        tool_name: 'search',
        tool_args: '{}',
        reasoning: '',
        status: '',
        is_final: false
      })).toBe(false)
    })
  })
})
