/**
 * `withSandbox` — outer wrapper that attaches a sandbox VM to a controller
 * pattern for its lifetime. See docs/sandbox-plan.md → "What withSandbox is".
 *
 * Build-order step 3 scope (this file): auto-attachment only. Every invocation
 * boots a fresh VM, runs the wrapped pattern inside the ALS sandbox scope,
 * then closes the transport and destroys the VM on exit. ID-addressable reuse
 * (`id: 'foo'`) and force-fresh (`fresh: true`) land in step 6; warm pool +
 * idle eviction + scheduler caps in step 5.
 */
import { assertServerOnImport } from '../harness-patterns/assert.server'
import { DockerBackend } from './docker-backend.server'
import { runWithSandbox } from './scope.server'
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
  /** Reserved for step 6 (force fresh); currently ignored — every invocation
   *  is fresh anyway in the no-pool world. */
  fresh?: boolean
  /** Rootfs flavor. v0: `'base'` only. */
  rootfs?: RootfsId
  /** Per-VM runtime knobs. Defaults come from HarnessSettings (added later). */
  resources?: Pick<RuntimeConfig, 'cpus' | 'memoryMB' | 'timeoutSec'>
  /** Egress profile. v0 honors `'mcp-only'` (no network) vs anything else. */
  egress?: RuntimeConfig['egress']
  /** Backend override. Defaults to a process-shared `DockerBackend`. Tests
   *  inject a mock here to exercise the wrapper without spinning containers. */
  backend?: ComputeBackend
}

let defaultBackend: ComputeBackend | null = null
function getDefaultBackend(): ComputeBackend {
  if (!defaultBackend) defaultBackend = new DockerBackend()
  return defaultBackend
}

/**
 * Wrap a pattern so its lifetime owns a sandbox VM. Composes orthogonally with
 * everything in the harness — `chain(withSandbox(actorCritic), synth)`,
 * `withSandbox(chain(simpleLoop, …, actorCritic))`, `router → routes`, etc.
 * The sandbox handle propagates to nested tool-calling controllers via ALS;
 * `chain` / `router` / `withReferences` don't need to be sandbox-aware.
 */
export function withSandbox(config?: WithSandboxConfig) {
  return <T>(pattern: ConfiguredPattern<T>): ConfiguredPattern<T> => {
    const backend = config?.backend ?? getDefaultBackend()
    const rootfs: RootfsId = config?.rootfs ?? 'base'
    const runtime: RuntimeConfig = {
      ...(config?.resources ?? {}),
      ...(config?.egress ? { egress: config.egress } : {}),
    }

    const fn = async (
      scope: PatternScope<T>,
      view: EventView,
    ): Promise<PatternScope<T>> => {
      const vm = await backend.boot(rootfs, runtime)
      let transport
      try {
        transport = await backend.connectMcp(vm)
      } catch (err) {
        // boot succeeded but transport setup failed — clean up the VM so we
        // don't leak. Swallow destroy errors; the original error is what the
        // caller cares about.
        await backend.destroy(vm).catch(() => {})
        throw err
      }
      try {
        return await runWithSandbox(transport, () => pattern.fn(scope, view))
      } finally {
        await transport.close().catch(() => {})
        await backend.destroy(vm).catch(() => {})
      }
    }

    return {
      ...pattern,
      name: `withSandbox(${pattern.name})`,
      fn,
    }
  }
}
