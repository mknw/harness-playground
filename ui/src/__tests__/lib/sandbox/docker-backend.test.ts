/**
 * DockerBackend unit tests.
 *
 * Hermetic — `node:child_process` spawn and the MCP SDK client/transport are
 * mocked so no real Docker engine is required. Covers boot arg construction,
 * destroy idempotency, health states, connectMcp tool routing/prefixing, and
 * the warm-pool recycle contract (destroy + boot fresh, handle mutated in
 * place with stable vm.id and preserved RuntimeConfig).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

// server-only guard is a no-op in tests
vi.mock('../../../lib/harness-patterns/assert.server', () => ({
  assertServerOnImport: vi.fn(),
}))

// ---- mock node:child_process.spawn ---------------------------------------
// Each spawn returns a fake child whose behavior is programmed per-test via
// `spawnScript`. The script receives the argv and returns { stdout, code }.
type SpawnPlan = (cmd: string, args: string[]) => { stdout?: string; stderr?: string; code?: number }
let spawnPlan: SpawnPlan = () => ({ stdout: '', code: 0 })
const spawnCalls: Array<{ cmd: string; args: string[] }> = []

function mockSpawn(cmd: string, args: string[]) {
  spawnCalls.push({ cmd, args })
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    kill: () => void
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = () => {}
  const plan = spawnPlan(cmd, args)
  // Emit asynchronously so listeners are attached first.
  queueMicrotask(() => {
    if (plan.stdout) child.stdout.emit('data', Buffer.from(plan.stdout))
    if (plan.stderr) child.stderr.emit('data', Buffer.from(plan.stderr))
    child.emit('close', plan.code ?? 0)
  })
  return child
}

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
  default: { spawn: mockSpawn },
}))

// ---- mock the MCP SDK client + stdio transport ---------------------------
// connectMcp opens one client per in-VM server; we give each a fixed
// listTools result keyed by the launch argv, and record callTool dispatch.
const callToolCalls: Array<{ server: string; name: string; args: unknown }> = []
let lastTransportArgs: string[][] = []

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class {
    args: string[]
    constructor(opts: { args: string[] }) {
      this.args = opts.args
      lastTransportArgs.push(opts.args)
    }
  },
}))

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    private serverKey = 'unknown'
    async connect(transport: { args: string[] }) {
      // launch argv is [..., 'serve', '<key>']
      this.serverKey = transport.args[transport.args.length - 1]
    }
    async listTools() {
      if (this.serverKey === 'filesystem') {
        return {
          tools: [
            { name: 'read_text_file', description: 'read', inputSchema: { type: 'object' } },
            { name: 'write_file', description: 'write', inputSchema: { type: 'object' } },
            { name: 'edit_file', description: 'edit', inputSchema: { type: 'object' } },
            { name: 'list_directory', description: 'list', inputSchema: { type: 'object' } },
            { name: 'search_files_content', description: 'search', inputSchema: { type: 'object' } },
            { name: 'directory_tree', description: 'not exposed', inputSchema: {} },
          ],
        }
      }
      if (this.serverKey === 'shell') {
        return { tools: [{ name: 'bash', description: 'shell', inputSchema: { type: 'object' } }] }
      }
      return { tools: [] }
    }
    async callTool({ name, arguments: args }: { name: string; arguments: unknown }) {
      callToolCalls.push({ server: this.serverKey, name, args })
      if (name === 'bash') {
        return {
          content: [{ type: 'text', text: JSON.stringify({ stdout: '3\n', exit_code: 0 }) }],
          structuredContent: { stdout: '3\n', exit_code: 0 },
          isError: false,
        }
      }
      return { content: [{ type: 'text', text: 'ok' }], isError: false }
    }
    async close() {}
  },
}))

beforeEach(() => {
  spawnCalls.length = 0
  callToolCalls.length = 0
  lastTransportArgs = []
  spawnPlan = () => ({ stdout: '', code: 0 })
})

async function makeBackend() {
  const mod = await import('../../../lib/sandbox/docker-backend.server')
  return new mod.DockerBackend()
}

describe('DockerBackend.boot', () => {
  it('runs a detached, auto-removed, network-none container by default (mcp-only egress)', async () => {
    spawnPlan = () => ({ stdout: 'container-abc123', code: 0 })
    const backend = await makeBackend()
    const handle = await backend.boot('base', {})

    expect(handle.backend).toBe('docker')
    expect(handle.rootfs).toBe('base')
    expect(handle.id).toMatch(/^sbx-/)
    expect((handle.native as { containerId: string }).containerId).toBe('container-abc123')

    const run = spawnCalls.find((c) => c.args[0] === 'run')!
    expect(run.args).toContain('-d')
    expect(run.args).toContain('--rm')
    // mcp-only ⇒ no network
    expect(run.args).toContain('--network')
    expect(run.args).toContain('none')
    // labels for reaping
    expect(run.args).toContain('--label')
    expect(run.args).toContain('kg-sandbox=1')
    // image last
    expect(run.args[run.args.length - 1]).toBe('kg-sandbox:base')
  })

  it('applies cpu/memory caps and leaves network in place for open egress', async () => {
    spawnPlan = () => ({ stdout: 'cid', code: 0 })
    const backend = await makeBackend()
    await backend.boot('base', { cpus: 2, memoryMB: 512, egress: 'open' })

    const run = spawnCalls.find((c) => c.args[0] === 'run')!
    expect(run.args).toContain('--cpus')
    expect(run.args).toContain('2')
    expect(run.args).toContain('--memory')
    expect(run.args).toContain('512m')
    expect(run.args).not.toContain('none')
  })

  it('throws SandboxBootError when docker run fails', async () => {
    spawnPlan = () => ({ stderr: 'no such image', code: 1 })
    const backend = await makeBackend()
    await expect(backend.boot('base', {})).rejects.toThrow(/boot failed/)
  })
})

describe('DockerBackend.destroy', () => {
  it('force-removes the container', async () => {
    spawnPlan = () => ({ stdout: 'ok', code: 0 })
    const backend = await makeBackend()
    const handle = await backend.boot('base', {})
    spawnCalls.length = 0
    await backend.destroy(handle)
    const rm = spawnCalls.find((c) => c.args[0] === 'rm')!
    expect(rm.args).toEqual(['rm', '-f', expect.any(String)])
  })

  it('is idempotent — swallows errors when the container is already gone', async () => {
    // boot succeeds (returns a cid); the later `rm` fails (already gone).
    spawnPlan = (cmd, args) => (args[0] === 'rm' ? { stderr: 'No such container', code: 1 } : { stdout: 'cid', code: 0 })
    const backend = await makeBackend()
    const handle = await backend.boot('base', {})
    await expect(backend.destroy(handle)).resolves.toBeUndefined()
  })
})

describe('DockerBackend.health', () => {
  it('reports healthy when running', async () => {
    spawnPlan = (cmd, args) => (args[0] === 'inspect' ? { stdout: 'running', code: 0 } : { stdout: 'cid', code: 0 })
    const backend = await makeBackend()
    const handle = await backend.boot('base', {})
    expect(await backend.health(handle)).toEqual({ state: 'healthy', detail: 'running' })
  })

  it('reports gone when inspect fails', async () => {
    spawnPlan = (cmd, args) => (args[0] === 'inspect' ? { code: 1, stderr: 'no such container' } : { stdout: 'cid', code: 0 })
    const backend = await makeBackend()
    const handle = await backend.boot('base', {})
    expect(await backend.health(handle)).toEqual({ state: 'gone' })
  })
})

describe('DockerBackend.connectMcp', () => {
  it('exposes the six v0 sandbox_* tools across both in-VM servers', async () => {
    spawnPlan = () => ({ stdout: 'cid', code: 0 })
    const backend = await makeBackend()
    const handle = await backend.boot('base', {})
    const transport = await backend.connectMcp(handle)

    const names = await transport.toolNames()
    expect(names.sort()).toEqual(
      ['sandbox_bash', 'sandbox_edit', 'sandbox_list', 'sandbox_read', 'sandbox_search', 'sandbox_write'].sort(),
    )
    // non-curated filesystem tools (directory_tree) are NOT exposed
    expect(names).not.toContain('sandbox_directory_tree')

    // connectMcp launched both servers via docker exec -i
    const serveKeys = lastTransportArgs.map((a) => a[a.length - 1]).sort()
    expect(serveKeys).toEqual(['filesystem', 'shell'])
    expect(lastTransportArgs.every((a) => a.slice(0, 3).join(' ') === 'exec -i cid')).toBe(true)

    await transport.close()
  })

  it('routes sandbox_bash to the shell server with the native name and parses structured output', async () => {
    spawnPlan = () => ({ stdout: 'cid', code: 0 })
    const backend = await makeBackend()
    const handle = await backend.boot('base', {})
    const transport = await backend.connectMcp(handle)

    const res = await transport.callTool('sandbox_bash', { command: "python3 -c 'print(len(\"a b c\".split()))'" })
    expect(res.success).toBe(true)
    expect(res.data).toEqual({ stdout: '3\n', exit_code: 0 })

    const dispatched = callToolCalls.find((c) => c.name === 'bash')!
    expect(dispatched.server).toBe('shell')

    expect(transport.ownsTool('sandbox_bash')).toBe(true)
    expect(transport.ownsTool('read_neo4j_cypher')).toBe(false)
    await transport.close()
  })

  it('returns a structured error for an unknown sandbox tool', async () => {
    spawnPlan = () => ({ stdout: 'cid', code: 0 })
    const backend = await makeBackend()
    const handle = await backend.boot('base', {})
    const transport = await backend.connectMcp(handle)
    const res = await transport.callTool('sandbox_nonexistent', {})
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/not found/)
    await transport.close()
  })
})

describe('DockerBackend.reset', () => {
  it('destroys the old container and boots a fresh one (warm-pool recycle)', async () => {
    let bootCount = 0
    spawnPlan = (cmd, args) => {
      if (args[0] === 'run') {
        bootCount += 1
        return { stdout: `container-${bootCount}`, code: 0 }
      }
      return { stdout: 'ok', code: 0 }
    }
    const backend = await makeBackend()
    const handle = await backend.boot('base', {})
    expect((handle.native as { containerId: string }).containerId).toBe('container-1')
    const originalId = handle.id

    spawnCalls.length = 0
    await backend.reset(handle)

    // Two docker calls: rm old, then run new.
    const rm = spawnCalls.find((c) => c.args[0] === 'rm')!
    expect(rm.args).toEqual(['rm', '-f', 'container-1'])
    const run = spawnCalls.find((c) => c.args[0] === 'run')!
    expect(run.args).toContain('-d')
    expect(run.args).toContain('--rm')

    // Handle mutated in place: sandbox id stable, container id swapped.
    expect(handle.id).toBe(originalId)
    expect((handle.native as { containerId: string }).containerId).toBe('container-2')
  })

  it('preserves the runtime config across the recycle', async () => {
    let bootCount = 0
    spawnPlan = (cmd, args) => {
      if (args[0] === 'run') {
        bootCount += 1
        return { stdout: `container-${bootCount}`, code: 0 }
      }
      return { stdout: 'ok', code: 0 }
    }
    const backend = await makeBackend()
    const handle = await backend.boot('base', { cpus: 2, memoryMB: 512, egress: 'open' })

    spawnCalls.length = 0
    await backend.reset(handle)

    const run = spawnCalls.find((c) => c.args[0] === 'run')!
    expect(run.args).toContain('--cpus')
    expect(run.args).toContain('2')
    expect(run.args).toContain('--memory')
    expect(run.args).toContain('512m')
    // egress: 'open' ⇒ no --network none
    expect(run.args).not.toContain('none')
    // Container is renamed to the same sandbox id so the slot is stable.
    const nameIdx = run.args.indexOf('--name')
    expect(run.args[nameIdx + 1]).toBe(handle.id)
  })

  it('updates bootedAt to the recycle time', async () => {
    spawnPlan = () => ({ stdout: 'cid', code: 0 })
    const backend = await makeBackend()
    const handle = await backend.boot('base', {})
    const firstBootedAt = handle.bootedAt
    // Sleep a tick so Date.now() advances past firstBootedAt; vitest's clock
    // resolution is enough that this is reliable.
    await new Promise((r) => setTimeout(r, 2))
    await backend.reset(handle)
    expect(handle.bootedAt).toBeGreaterThan(firstBootedAt)
  })

  it('proceeds when the old container is already gone (rm failure is swallowed)', async () => {
    let runCount = 0
    spawnPlan = (cmd, args) => {
      if (args[0] === 'rm') return { stderr: 'No such container', code: 1 }
      if (args[0] === 'run') {
        runCount += 1
        return { stdout: `container-${runCount}`, code: 0 }
      }
      return { stdout: '', code: 0 }
    }
    const backend = await makeBackend()
    const handle = await backend.boot('base', {})
    await expect(backend.reset(handle)).resolves.toBeUndefined()
    expect((handle.native as { containerId: string }).containerId).toBe('container-2')
  })

  it('throws SandboxBootError when the reboot fails', async () => {
    let runCount = 0
    spawnPlan = (cmd, args) => {
      if (args[0] === 'run') {
        runCount += 1
        if (runCount === 2) return { stderr: 'image missing', code: 1 }
        return { stdout: 'container-1', code: 0 }
      }
      return { stdout: 'ok', code: 0 }
    }
    const backend = await makeBackend()
    const handle = await backend.boot('base', {})
    await expect(backend.reset(handle)).rejects.toThrow(/boot failed/)
  })
})
