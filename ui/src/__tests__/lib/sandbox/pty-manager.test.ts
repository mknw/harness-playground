/**
 * PtyManager unit tests — the #97 Gap 3 hydrate-on-first-boot logic.
 *
 * Hermetic: node-pty (a native addon), the shared AttachmentTable, and
 * `hydrateWorkspace` are all mocked, so no Docker / MCP SDK / pseudo-TTY is
 * involved. We assert the one new decision — whether the Shell hydrates
 * /work/in when it is the first to boot the session container — across the
 * sync/non-sync and first-boot/reused axes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock factories are hoisted above imports; build the spies in a hoisted
// block so the factories can close over them without a TDZ error.
const mocks = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  hydrateMock: vi.fn(),
  acquireMock: vi.fn(),
  releaseMock: vi.fn(),
}))

vi.mock('../../../lib/harness-patterns/assert.server', () => ({
  assertServerOnImport: vi.fn(),
}))

vi.mock('node-pty', () => ({ spawn: mocks.spawnMock }))

vi.mock('../../../lib/sandbox/work-artifacts.server', () => ({
  hydrateWorkspace: mocks.hydrateMock,
}))

vi.mock('../../../lib/sandbox/with-sandbox.server', () => ({
  getDefaultAttachments: () => ({ acquire: mocks.acquireMock, release: mocks.releaseMock }),
}))

import { PtyManager } from '../../../lib/sandbox/pty-manager.server'

// ---- fakes ---------------------------------------------------------------

function makeFakeIPty() {
  return {
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
  }
}

type FakeAttachment = {
  id: string
  refCount: number
  lastUsedAt: number
  isFirstBoot: boolean
  vm: { native: { containerId: string } }
  transport: Record<string, unknown>
}

let attachment: FakeAttachment

beforeEach(() => {
  mocks.spawnMock.mockReset().mockImplementation(() => makeFakeIPty())
  mocks.hydrateMock.mockReset().mockResolvedValue(0)
  mocks.acquireMock.mockReset()
  mocks.releaseMock.mockReset()

  attachment = {
    id: 's1',
    refCount: 1,
    lastUsedAt: 0,
    isFirstBoot: true,
    vm: { native: { containerId: 'cid-1' } },
    transport: { vmId: 's1' },
  }
  mocks.acquireMock.mockResolvedValue(attachment)
})

// ---- tests ---------------------------------------------------------------

describe('PtyManager.ensure — hydrate on first boot (#97 Gap 3)', () => {
  it('hydrates /work/in when the session uses durable workspaces and this is the first boot', async () => {
    const mgr = new PtyManager()
    await mgr.ensure('s1', { syncWorkspace: true })

    expect(mocks.hydrateMock).toHaveBeenCalledTimes(1)
    expect(mocks.hydrateMock).toHaveBeenCalledWith(attachment.transport, 's1')
    expect(attachment.isFirstBoot).toBe(false) // flipped so the agent turn won't re-hydrate
    expect(mocks.spawnMock).toHaveBeenCalledTimes(1) // shell still spawned
  })

  it('does not hydrate when the container was already booted (agent ran first)', async () => {
    attachment.isFirstBoot = false
    const mgr = new PtyManager()
    await mgr.ensure('s1', { syncWorkspace: true })

    expect(mocks.hydrateMock).not.toHaveBeenCalled()
    expect(mocks.spawnMock).toHaveBeenCalledTimes(1)
  })

  it('does not hydrate for a non-durable-workspace session', async () => {
    const mgr = new PtyManager()
    await mgr.ensure('s1', { syncWorkspace: false })

    expect(mocks.hydrateMock).not.toHaveBeenCalled()
    expect(attachment.isFirstBoot).toBe(true) // untouched
    expect(mocks.spawnMock).toHaveBeenCalledTimes(1)
  })

  it('defaults to no hydrate when opts are omitted (older client / no agentId)', async () => {
    const mgr = new PtyManager()
    await mgr.ensure('s1')

    expect(mocks.hydrateMock).not.toHaveBeenCalled()
    expect(mocks.spawnMock).toHaveBeenCalledTimes(1)
  })

  it('opens the shell even if hydrate fails (best-effort), flipping isFirstBoot like the agent path', async () => {
    mocks.hydrateMock.mockRejectedValueOnce(new Error('gateway down'))
    const mgr = new PtyManager()
    await expect(mgr.ensure('s1', { syncWorkspace: true })).resolves.toBeUndefined()

    expect(mocks.spawnMock).toHaveBeenCalledTimes(1)
    expect(attachment.isFirstBoot).toBe(false)
  })

  it('only boots/hydrates once even across concurrent ensure calls', async () => {
    const mgr = new PtyManager()
    await Promise.all([
      mgr.ensure('s1', { syncWorkspace: true }),
      mgr.ensure('s1', { syncWorkspace: true }),
    ])
    expect(mocks.acquireMock).toHaveBeenCalledTimes(1)
    expect(mocks.hydrateMock).toHaveBeenCalledTimes(1)
    expect(mocks.spawnMock).toHaveBeenCalledTimes(1)
  })
})
