/**
 * useChainProgress — derives a "current/total" progress view from a stream of
 * harness `ContextEvent`s arriving over SSE.
 *
 * Total grows monotonically as `pattern_enter` events arrive; if a pattern
 * exposes `maxTurns` (simpleLoop / actorCritic) it contributes `maxTurns`,
 * otherwise it contributes 1. Wrapper patterns (routes, withApproval, …) are
 * skipped — when a pattern_enter is immediately followed by another
 * pattern_enter without intermediate work, the first is treated as a wrapper.
 *
 * Current advances on `controller_action` (per-turn for loops) and on
 * non-loop content events (router/synthesizer assistant_message, etc.).
 *
 * The hook is purely UI display logic — kept out of `harness-patterns/` so
 * the library can stay a neutral primitives package.
 */
import { createSignal } from 'solid-js'
import type { ContextEvent } from '~/lib/harness-patterns'

export interface ChainProgressSnapshot {
  currentTurn: number
  totalTurns: number
  status: string | null
  done: boolean
}

const empty = (): ChainProgressSnapshot => ({
  currentTurn: 0,
  totalTurns: 0,
  status: null,
  done: false,
})

const STATUS_MAX_LENGTH = 140

const truncate = (s: string): string =>
  s.length > STATUS_MAX_LENGTH ? `${s.slice(0, STATUS_MAX_LENGTH - 1)}…` : s

const firstLine = (s: string): string => {
  const idx = s.indexOf('\n')
  return idx === -1 ? s : s.slice(0, idx)
}

export interface ChainProgressController {
  snapshot: () => ChainProgressSnapshot
  /** Apply one new event from the SSE stream. */
  ingest: (event: ContextEvent) => void
  /** Mark the chain finished — bar can fade out. */
  finish: () => void
  /** Reset for a new turn. */
  reset: () => void
}

export function createChainProgress(): ChainProgressController {
  const [snapshot, setSnapshot] = createSignal<ChainProgressSnapshot>(empty())

  // A pending pattern_enter is held until we see whether the next event is
  // another pattern_enter (wrapper — discard) or content (commit).
  let pendingEnter: { contribution: number; patternId: string } | null = null
  let advancedForPattern: string | null = null

  const flushPendingEnter = () => {
    if (!pendingEnter) return
    const contrib = pendingEnter.contribution
    pendingEnter = null
    setSnapshot((prev) => ({ ...prev, totalTurns: prev.totalTurns + contrib }))
  }

  const advanceCurrent = (status: string | null) => {
    setSnapshot((prev) => ({
      ...prev,
      currentTurn: Math.min(prev.currentTurn + 1, prev.totalTurns),
      status: status ?? prev.status,
    }))
  }

  const setStatus = (status: string) => {
    setSnapshot((prev) => ({ ...prev, status }))
  }

  return {
    snapshot,

    reset() {
      pendingEnter = null
      advancedForPattern = null
      setSnapshot(empty())
    },

    finish() {
      flushPendingEnter()
      setSnapshot((prev) => ({ ...prev, done: true }))
    },

    ingest(event) {
      switch (event.type) {
        case 'pattern_enter': {
          // A new pattern_enter discards a previously-pending one (wrapper case).
          const data = event.data as { pattern?: string; maxTurns?: number }
          const contribution = typeof data.maxTurns === 'number' && data.maxTurns > 0 ? data.maxTurns : 1
          pendingEnter = { contribution, patternId: event.patternId }
          advancedForPattern = null
          break
        }

        case 'controller_action': {
          flushPendingEnter()
          const action = (event.data as { action?: { status?: string } }).action
          const status = action?.status ? truncate(action.status) : null
          advanceCurrent(status)
          advancedForPattern = event.patternId
          break
        }

        case 'assistant_message': {
          // Mid-chain assistant message (router decision, synthesizer output).
          flushPendingEnter()
          const content = (event.data as { content?: string }).content ?? ''
          const preview = truncate(firstLine(content.trim()))
          // Only advance once per pattern so a streamed/partial assistant message
          // doesn't double-count.
          if (advancedForPattern !== event.patternId) {
            advanceCurrent(preview || null)
            advancedForPattern = event.patternId
          } else if (preview) {
            setStatus(preview)
          }
          break
        }

        case 'tool_call': {
          // Tool calls don't advance the bar (controller_action already did)
          // but we surface a friendly status while the call is in flight.
          flushPendingEnter()
          const tool = (event.data as { tool?: string }).tool ?? 'tool'
          setStatus(`Calling ${tool}…`)
          break
        }

        case 'pattern_exit': {
          // Exit without intermediate content (e.g., a no-op pattern) — count
          // the pending enter so the bar still advances.
          if (pendingEnter && pendingEnter.patternId === event.patternId) {
            flushPendingEnter()
            advanceCurrent(null)
          }
          break
        }

        case 'error': {
          flushPendingEnter()
          const err = (event.data as { error?: string }).error ?? 'error'
          setStatus(truncate(err))
          break
        }

        default:
          // Ignore other event types (user_message, tool_result, etc.).
          break
      }
    },
  }
}
