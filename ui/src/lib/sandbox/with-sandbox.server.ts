/**
 * `withSandbox` — outer wrapper that attaches a sandbox VM to a controller
 * pattern for its lifetime. See docs/sandbox-plan.md → "What withSandbox is".
 *
 * Acquisition path (build-order step 5):
 *   1. `scheduler.allocate(sessionId)` — blocks if either cap is reached.
 *   2. `pool.acquire(rootfs, runtime)`  — pool-hit (O(ms)) or cold-boot.
 *   3. `backend.connectMcp(vm)`         — open the in-VM MCP transport.
 *
 * Release path (reverse order, runs even on inner throws / partial failure):
 *   1. `transport.close()`              — tear down stdio pipes.
 *   2. `pool.release(vm)`               — reset & park, or destroy on cap/fail.
 *   3. `slot.release()`                 — free the scheduler slot.
 *
 * ID-addressable reuse (`id: 'foo'`) and force-fresh (`fresh: true`) remain
 * deferred to build-order step 6.
 */
import { assertServerOnImport } from '../harness-patterns/assert.server'
import { DEFAULT_SETTINGS } from '../settings'
import { getRequestSettings } from '../settings-context.server'
import { DockerBackend } from './docker-backend.server'
import { runWithSandbox } from './scope.server'
import { SandboxScheduler } from './scheduler.server'
import { WarmPool } from './warm-pool.server'
import type { ComputeBackend, RootfsId, RuntimeConfig } from './types'
import type {
  ConfiguredPattern,
  PatternScope,
  EventView,
} from '../harness-patterns/types'

assertServerOnImport()

export interface WithSandboxConfig {
  /** Reserved for step 6 (ID-addressable attachment); currently ignored. */
  id?: string
  /** Reserved for step 6 (force fresh); currently ignored. */
  fresh?: boolean
  /** Rootfs flavor. v0: `'base'` only. */
  rootfs?: RootfsId
  /** Per-VM runtime knobs. Defaults come from `settings.sandbox.*`. */
  resources?: Pick<RuntimeConfig, 'cpus' | 'memoryMB' | 'timeoutSec'>
  /** Egress profile. Defaults to `settings.sandbox.defaultEgress`. */
  egress?: RuntimeConfig['egress']
  /** Session id for `SandboxScheduler` per-session-cap accounting. */
  sessionId?: string
  /** Backend override. Defaults to a process-shared `DockerBackend`. */
  backend?: ComputeBackend
  /** Pool override. Defaults to a process-shared `WarmPool` from settings. */
  pool?: WarmPool
  /** Scheduler override. Defaults to a process-shared `SandboxScheduler`. */
  scheduler?: SandboxScheduler
}

// Process-shared singletons, lazily constructed from DEFAULT_SETTINGS. Cap
// values are read once at first use; the settings panel can't reshape an
// already-built scheduler/pool at runtime (those caps are process-scoped, not
// per-request — see docs/sandbox-plan.md → "Settings").
let defaultBackend: ComputeBackend | null = null
let defaultPool: WarmPool | null = null
let defaultScheduler: SandboxScheduler | null = null

function getDefaultBackend(): ComputeBackend {
  if (!defaultBackend) defaultBackend = new DockerBackend()
  return defaultBackend
}
function getDefaultPool(): WarmPool {
  if (!defaultPool) {
    defaultPool = new WarmPool(getDefaultBackend(), {
      caps: DEFAULT_SETTINGS.sandbox.warmPool,
      idleEvictMs: DEFAULT_SETTINGS.sandbox.idleEvictMs,
    })
  }
  return defaultPool
}
function getDefaultScheduler(): SandboxScheduler {
  if (!defaultScheduler) {
    defaultScheduler = new SandboxScheduler({
      globalCap: DEFAULT_SETTINGS.sandbox.globalCap,
      perSessionCap: DEFAULT_SETTINGS.sandbox.perSessionCap,
    })
  }
  return defaultScheduler
}

/**
 * Wrap a pattern so its lifetime owns a sandbox VM. Composes orthogonally
 * with everything in the harness — `chain(withSandbox(actorCritic), synth)`,
 * `withSandbox(chain(simpleLoop, …, actorCritic))`, `router → routes`, etc.
 * The sandbox handle propagates to nested tool-calling controllers via ALS;
 * `chain` / `router` / `withReferences` don't need to be sandbox-aware.
 */
export function withSandbox(config?: WithSandboxConfig) {
  return <T>(pattern: ConfiguredPattern<T>): ConfiguredPattern<T> => {
    const backend = config?.backend ?? getDefaultBackend()
    // When the caller injects a custom backend (test scenario), build per-call
    // pool + scheduler so test state doesn't bleed through the singletons.
    // Tests can still inject `pool` / `scheduler` explicitly to share state
    // across multiple withSandbox invocations (smoke-script pool-hit case).
    const usingDefaultBackend = !config?.backend
    const pool =
      config?.pool ??
      (usingDefaultBackend
        ? getDefaultPool()
        : new WarmPool(backend, {
            caps: DEFAULT_SETTINGS.sandbox.warmPool,
            idleEvictMs: DEFAULT_SETTINGS.sandbox.idleEvictMs,
          }))
    const scheduler =
      config?.scheduler ??
      (usingDefaultBackend
        ? getDefaultScheduler()
        : new SandboxScheduler({
            globalCap: DEFAULT_SETTINGS.sandbox.globalCap,
            perSessionCap: DEFAULT_SETTINGS.sandbox.perSessionCap,
          }))

    const rootfs: RootfsId = config?.rootfs ?? 'base'
    const sessionId = config?.sessionId ?? 'default'

    const fn = async (
      scope: PatternScope<T>,
      view: EventView,
    ): Promise<PatternScope<T>> => {
      const settings = getRequestSettings()
      const runtime: RuntimeConfig = {
        cpus: config?.resources?.cpus,
        memoryMB: config?.resources?.memoryMB ?? settings.sandbox.defaultMemoryMB,
        timeoutSec: config?.resources?.timeoutSec ?? settings.sandbox.defaultTimeoutSec,
        egress: config?.egress ?? settings.sandbox.defaultEgress,
      }

      const slot = await scheduler.allocate(sessionId)
      try {
        const vm = await pool.acquire(rootfs, runtime)
        let transport
        try {
          transport = await backend.connectMcp(vm)
        } catch (err) {
          // Acquire succeeded but transport setup failed — recycle the VM
          // (pool.release destroys if reset fails, parks if it succeeds and
          // there's cap). Original error wins.
          await pool.release(vm).catch(() => {})
          throw err
        }
        try {
          return await runWithSandbox(transport, () => pattern.fn(scope, view))
        } finally {
          await transport.close().catch(() => {})
          await pool.release(vm).catch(() => {})
        }
      } finally {
        slot.release()
      }
    }

    return {
      ...pattern,
      name: `withSandbox(${pattern.name})`,
      fn,
    }
  }
}
