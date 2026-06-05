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
import { WarmPool } from '../../../lib/sandbox/warm-pool.server'
import { SandboxScheduler } from '../../../lib/sandbox/scheduler.server'
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

  it('forwards rootfs and caller-supplied resources/egress to backend.boot', async () => {
    const backend = fakeBackend()
    const inner = fakePattern(async (scope) => scope)

    await withSandbox({
      backend,
      rootfs: 'base',
      resources: { cpus: 2, memoryMB: 1024 },
      egress: 'open',
    })(inner).fn(fakeScope({}), fakeView)

    // Caller-supplied wins; timeoutSec gets the settings default.
    expect(backend.calls.boot[0].rootfs).toBe('base')
    expect(backend.calls.boot[0].runtime).toMatchObject({
      cpus: 2,
      memoryMB: 1024,
      egress: 'open',
      timeoutSec: 60, // DEFAULT_SETTINGS.sandbox.defaultTimeoutSec
    })
  })

  it('fills missing resources/egress from settings.sandbox defaults', async () => {
    const backend = fakeBackend()
    const inner = fakePattern(async (scope) => scope)

    await withSandbox({ backend })(inner).fn(fakeScope({}), fakeView)

    expect(backend.calls.boot[0].runtime).toMatchObject({
      memoryMB: 512, // defaultMemoryMB
      timeoutSec: 60, // defaultTimeoutSec
      egress: 'mcp-only', // defaultEgress
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

describe('withSandbox scheduler + pool wiring', () => {
  it('routes acquire/release through the injected pool', async () => {
    const backend = fakeBackend()
    // Spy on a real WarmPool's methods so we see the wrapper's call sequence.
    const pool = new WarmPool(backend, { caps: { base: 2 }, idleEvictMs: 60_000 })
    const acquireSpy = vi.spyOn(pool, 'acquire')
    const releaseSpy = vi.spyOn(pool, 'release')

    const inner = fakePattern(async (scope) => scope)
    await withSandbox({ backend, pool, rootfs: 'base' })(inner).fn(
      fakeScope({}),
      fakeView,
    )

    expect(acquireSpy).toHaveBeenCalledWith('base', expect.any(Object))
    expect(releaseSpy).toHaveBeenCalledTimes(1)
  })

  it('parks the VM in the pool when reset succeeds (subsequent acquire hits)', async () => {
    const backend = fakeBackend()
    // fakeBackend's default reset throws; install a working reset for this case.
    backend.reset = vi.fn(async (vm) => {
      ;(vm as { bootedAt: number }).bootedAt = Date.now()
    })
    const pool = new WarmPool(backend, { caps: { base: 1 }, idleEvictMs: 60_000 })
    const inner = fakePattern(async (scope) => scope)
    const wrap = withSandbox({ backend, pool, rootfs: 'base' })(inner)

    await wrap.fn(fakeScope({}), fakeView)
    expect(backend.calls.boot).toHaveLength(1)
    expect(pool.size('base')).toBe(1) // parked
    expect(backend.calls.destroy).toHaveLength(0)

    // Second invocation: pool-hit, no new boot.
    await wrap.fn(fakeScope({}), fakeView)
    expect(backend.calls.boot).toHaveLength(1)
    expect(pool.size('base')).toBe(1) // re-parked
  })

  it('allocates and releases scheduler slots with the provided sessionId', async () => {
    const backend = fakeBackend()
    backend.reset = vi.fn(async () => {})
    const pool = new WarmPool(backend, { caps: { base: 1 }, idleEvictMs: 60_000 })
    const scheduler = new SandboxScheduler({ globalCap: 4, perSessionCap: 2 })
    const allocSpy = vi.spyOn(scheduler, 'allocate')

    const inner = fakePattern(async (scope) => scope)
    await withSandbox({ backend, pool, scheduler, sessionId: 'sess-99' })(inner).fn(
      fakeScope({}),
      fakeView,
    )

    expect(allocSpy).toHaveBeenCalledWith('sess-99')
    expect(scheduler.inflightCount()).toBe(0) // slot released on cleanup
  })

  it('blocks a second invocation when the scheduler is at globalCap', async () => {
    const backend = fakeBackend()
    backend.reset = vi.fn(async () => {})
    const pool = new WarmPool(backend, { caps: { base: 2 }, idleEvictMs: 60_000 })
    const scheduler = new SandboxScheduler({ globalCap: 1, perSessionCap: 4 })

    let gateOpen = false
    const releaseGate = new Promise<void>((resolve) => {
      const id = setInterval(() => {
        if (gateOpen) {
          clearInterval(id)
          resolve()
        }
      }, 5)
    })

    const slow = fakePattern(async (scope) => {
      await releaseGate
      return scope
    })
    const fast = fakePattern(async (scope) => scope)

    const slowP = withSandbox({ backend, pool, scheduler, sessionId: 's1' })(slow).fn(
      fakeScope({}),
      fakeView,
    )
    // Give slow a tick to claim the slot.
    await new Promise((r) => setImmediate(r))
    expect(scheduler.inflightCount()).toBe(1)
    expect(scheduler.queueDepth()).toBe(0)

    const fastP = withSandbox({ backend, pool, scheduler, sessionId: 's2' })(fast).fn(
      fakeScope({}),
      fakeView,
    )
    await new Promise((r) => setImmediate(r))
    // fast is queued behind slow.
    expect(scheduler.queueDepth()).toBe(1)

    gateOpen = true
    await Promise.all([slowP, fastP])
    expect(scheduler.inflightCount()).toBe(0)
  })

  it('releases the scheduler slot even if the inner pattern throws', async () => {
    const backend = fakeBackend()
    backend.reset = vi.fn(async () => {})
    const pool = new WarmPool(backend, { caps: { base: 1 }, idleEvictMs: 60_000 })
    const scheduler = new SandboxScheduler({ globalCap: 1, perSessionCap: 1 })
    const inner = fakePattern(async () => {
      throw new Error('inner went pop')
    })

    await expect(
      withSandbox({ backend, pool, scheduler, sessionId: 's1' })(inner).fn(
        fakeScope({}),
        fakeView,
      ),
    ).rejects.toThrow('inner went pop')
    expect(scheduler.inflightCount()).toBe(0)
  })
})
