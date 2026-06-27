/**
 * config.server — getCodeModeAllowedTools usesCodeMode gate source.
 *
 * The Tools panel greys out for agents that don't run a code-mode pattern. To
 * make that track the LIVE agent selection (not lag a turn behind the persisted
 * session), getCodeModeAllowedTools takes an optional selectedAgentId and gates
 * on it, preferring it over the persisted agent. Mocks the registry's
 * agentUsesCodeMode (no real pattern build / gateway call).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const agentUsesCodeMode = vi.fn(async () => false)
vi.mock('../../../lib/harness-client/registry.server', () => ({ agentUsesCodeMode }))

const loadSession = vi.fn()
vi.mock('../../../lib/harness-client/session.server', () => ({
  loadSession,
  saveSession: vi.fn(),
}))

vi.mock('../../../lib/harness-patterns/mcp-client.server', () => ({
  listTools: vi.fn(async () => [{ name: 'read_neo4j_cypher' }]),
}))

vi.mock('../../../lib/harness-patterns', () => ({
  deserializeContext: vi.fn(() => ({ data: {} })),
  serializeContext: vi.fn(() => '{}'),
}))

vi.mock('../../../lib/auth/server', () => ({
  getAuthenticatedUser: vi.fn(async () => ({ id: 'u1' })),
}))

vi.mock('../../../lib/tool-config/server-catalog.server', () => ({
  getPresetTools: vi.fn(async () => ['read_neo4j_cypher']),
}))

describe('getCodeModeAllowedTools — usesCodeMode gate source', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    agentUsesCodeMode.mockResolvedValue(false)
  })

  it('prefers the client-selected agent over the persisted one', async () => {
    // Persisted as code-mode, but the user has switched the live selection to default.
    loadSession.mockResolvedValue({ serializedContext: '{}', agentId: 'code-mode' })
    const { getCodeModeAllowedTools } = await import('../../../lib/tool-config/config.server')

    const res = await getCodeModeAllowedTools('s1', 'default')

    expect(agentUsesCodeMode).toHaveBeenCalledWith('default', 's1')
    expect(res.usesCodeMode).toBe(false)
  })

  it('falls back to the persisted agent when no selection is passed', async () => {
    loadSession.mockResolvedValue({ serializedContext: '{}', agentId: 'code-mode' })
    agentUsesCodeMode.mockResolvedValue(true)
    const { getCodeModeAllowedTools } = await import('../../../lib/tool-config/config.server')

    const res = await getCodeModeAllowedTools('s1')

    expect(agentUsesCodeMode).toHaveBeenCalledWith('code-mode', 's1')
    expect(res.usesCodeMode).toBe(true)
  })

  it('stays optimistic (true) when neither selection nor session is known', async () => {
    loadSession.mockResolvedValue(null)
    const { getCodeModeAllowedTools } = await import('../../../lib/tool-config/config.server')

    const res = await getCodeModeAllowedTools('s1')

    expect(agentUsesCodeMode).not.toHaveBeenCalled()
    expect(res.usesCodeMode).toBe(true)
  })
})
