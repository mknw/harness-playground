/**
 * `withSandbox` wrapper unit tests.
 *
 * Backend is mocked — these tests don't spawn containers. They verify the
 * wrapper's sequencing (boot → connectMcp → runWithSandbox(inner.fn) →
 * close + destroy), cleanup discipline on partial failure, and the
 * visibility guarantee that the inner pattern sees the transport via ALS.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../lib/harness-patterns/assert.server', () => ({
  assertServerOnImport: vi.fn(),
}))

import { withSandbox } from '../../../lib/sandbox/with-sandbox.server'
import { getActiveSandbox } from '../../../lib/sandbox/scope.server'
import type {
  ComputeBackend,
  HealthStatus,
  McpTransport,
  RootfsId,
  RuntimeConfig,
  VMHandle,
} from '../../../lib/sandbox/types'
import type {
  ConfiguredPattern,
  PatternScope,
  EventView,
} from '../../../lib/harness-patterns/types'

type Calls = {
  boot: Array<{ rootfs: RootfsId; runtime: RuntimeConfig }>
  destroy: VMHandle[]
  connectMcp: VMHandle[]
  closes: number
}

function fakeBackend(opts?: {
  connectMcpFails?: boolean
}): ComputeBackend & { calls: Calls } {
  const calls: Calls = { boot: [], destroy: [], connectMcp: [], closes: 0 }
  const handle: VMHandle = {
    id: 'sbx-test',
    backend: 'docker',
    rootfs: 'base',
    bootedAt: Date.now(),
    native: { containerId: 'cid-test' },
  }
  const transport: McpTransport = {
    vmId: handle.id,
    toolNames: async () => ['sandbox_bash'],
    listTools: async () => [
      { name: 'sandbox_bash', description: 'run a shell command', inputSchema: {} },
    ],
    ownsTool: (name: string) => name === 'sandbox_bash',
    callTool: async () => ({ success: true, data: null }),
    close: async () => {
      calls.closes += 1
    },
  }
  const backend: ComputeBackend & { calls: Calls } = {
    kind: 'docker',
    calls,
    async boot(rootfs, runtime) {
      calls.boot.push({ rootfs, runtime })
      return handle
    },
    async destroy(vm) {
      calls.destroy.push(vm)
    },
    async reset() {
      throw new Error('not used')
    },
    async connectMcp(vm) {
      calls.connectMcp.push(vm)
      if (opts?.connectMcpFails) throw new Error('boom')
      return transport
    },
    async health(): Promise<HealthStatus> {
      return { state: 'healthy' }
    },
  }
  return backend
}

function fakePattern<T extends Record<string, unknown>>(
  fn: (scope: PatternScope<T>, view: EventView) => Promise<PatternScope<T>>,
): ConfiguredPattern<T> {
  return {
    name: 'inner',
    fn,
    config: { patternId: 'inner', trackHistory: true, errorSeverity: 'irrecoverable' },
    estimateTurns: () => 3,
  }
}

function fakeScope<T>(data: T): PatternScope<T> {
  return { id: 'inner', events: [], data, startTime: Date.now() }
}

const fakeView = {} as unknown as EventView

describe('withSandbox', () => {
  it('boots, runs the inner pattern, then closes and destroys', async () => {
    const backend = fakeBackend()
    let innerRan = false
    const inner = fakePattern<{ ran?: boolean }>(async (scope) => {
      innerRan = true
      scope.data = { ...scope.data, ran: true }
      return scope
    })

    const wrapped = withSandbox({ backend, rootfs: 'base' })(inner)
    const out = await wrapped.fn(fakeScope({}), fakeView)

    expect(innerRan).toBe(true)
    expect(out.data.ran).toBe(true)
    expect(backend.calls.boot).toHaveLength(1)
    expect(backend.calls.boot[0].rootfs).toBe('base')
    expect(backend.calls.connectMcp).toHaveLength(1)
    expect(backend.calls.closes).toBe(1)
    expect(backend.calls.destroy).toHaveLength(1)
  })

  it('exposes the transport to the inner pattern via getActiveSandbox', async () => {
    const backend = fakeBackend()
    let seenVmId: string | undefined
    let seenOwns: boolean | undefined
    const inner = fakePattern(async (scope) => {
      const t = getActiveSandbox()
      seenVmId = t?.vmId
      seenOwns = t?.ownsTool('sandbox_bash')
      return scope
    })

    await withSandbox({ backend })(inner).fn(fakeScope({}), fakeView)

    expect(seenVmId).toBe('sbx-test')
    expect(seenOwns).toBe(true)
    expect(getActiveSandbox()).toBeUndefined()
  })

  it('destroys the VM if connectMcp fails (no leak)', async () => {
    const backend = fakeBackend({ connectMcpFails: true })
    const inner = fakePattern(async (scope) => scope)

    const wrapped = withSandbox({ backend })(inner)
    await expect(wrapped.fn(fakeScope({}), fakeView)).rejects.toThrow('boom')

    expect(backend.calls.boot).toHaveLength(1)
    expect(backend.calls.destroy).toHaveLength(1)
    // transport never opened, so no close call
    expect(backend.calls.closes).toBe(0)
  })

  it('runs cleanup even if the inner pattern throws', async () => {
    const backend = fakeBackend()
    const inner = fakePattern(async () => {
      throw new Error('inner failure')
    })

    const wrapped = withSandbox({ backend })(inner)
    await expect(wrapped.fn(fakeScope({}), fakeView)).rejects.toThrow('inner failure')

    expect(backend.calls.closes).toBe(1)
    expect(backend.calls.destroy).toHaveLength(1)
  })

  it('forwards rootfs, resources, and egress to backend.boot', async () => {
    const backend = fakeBackend()
    const inner = fakePattern(async (scope) => scope)

    await withSandbox({
      backend,
      rootfs: 'base',
      resources: { cpus: 2, memoryMB: 1024 },
      egress: 'open',
    })(inner).fn(fakeScope({}), fakeView)

    expect(backend.calls.boot[0]).toEqual({
      rootfs: 'base',
      runtime: { cpus: 2, memoryMB: 1024, egress: 'open' },
    })
  })

  it('prefixes the inner pattern name and preserves config / estimateTurns', () => {
    const backend = fakeBackend()
    const inner = fakePattern(async (scope) => scope)
    const wrapped = withSandbox({ backend })(inner)

    expect(wrapped.name).toBe('withSandbox(inner)')
    expect(wrapped.config).toEqual(inner.config)
    expect(wrapped.estimateTurns?.({ maxToolTurns: 10, maxRetries: 3 })).toBe(3)
  })
})
