/**
 * ChatSidebar — placeholder merge logic.
 *
 * Covers the optimistic "+ New Chat" placeholder rules from #44:
 *  - placeholder is prepended when its id is not in the persisted list
 *  - placeholder is dropped once the persisted row arrives (the real row
 *    replaces the optimistic one in-place at the top of the list)
 *  - no placeholder when `placeholderId` is null
 */

import { describe, it, expect } from 'vitest'
import {
  mergeThreadsWithPlaceholder,
  type ChatThreadSummary,
} from '../../../components/ark-ui/ChatSidebar'

const persisted: ChatThreadSummary[] = [
  { id: 'a', title: 'Alpha', updatedAt: '2026-05-10T00:00:00Z' },
  { id: 'b', title: 'Beta', updatedAt: '2026-05-09T00:00:00Z' },
]

describe('mergeThreadsWithPlaceholder', () => {
  it('returns persisted list unchanged when no placeholder is set', () => {
    expect(mergeThreadsWithPlaceholder(persisted, null)).toBe(persisted)
  })

  it('prepends an optimistic placeholder when its id is not yet persisted', () => {
    const merged = mergeThreadsWithPlaceholder(
      persisted,
      'new-id',
      () => '2026-05-10T12:00:00Z',
    )
    expect(merged).toHaveLength(3)
    expect(merged[0]).toEqual({
      id: 'new-id',
      title: null,
      updatedAt: '2026-05-10T12:00:00Z',
      isPlaceholder: true,
    })
    expect(merged[1].id).toBe('a')
    expect(merged[2].id).toBe('b')
  })

  it('drops the placeholder once a persisted row with the same id arrives', () => {
    const withRow: ChatThreadSummary[] = [
      { id: 'new-id', title: 'First message…', updatedAt: '2026-05-10T12:00:00Z' },
      ...persisted,
    ]
    const merged = mergeThreadsWithPlaceholder(withRow, 'new-id')
    expect(merged).toBe(withRow)
    expect(merged.some((t) => t.isPlaceholder)).toBe(false)
  })

  it('never produces duplicate ids', () => {
    const merged = mergeThreadsWithPlaceholder(persisted, 'new-id')
    const ids = merged.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
