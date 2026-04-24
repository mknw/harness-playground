/**
 * Harness
 *
 * Composes patterns into a callable agent.
 * Uses UnifiedContext for session persistence and event tracking.
 */

import { assertServerOnImport } from './assert.server'
import { runChain } from './patterns/chain.server'
import type {
  CtxStatus,
  ContextEvent,
  HarnessResult,
  UnifiedContext,
  ConfiguredPattern,
  AssistantMessageEventData
} from './types'
import {
  createContext,
  serializeContext,
  deserializeContext,
  setError as setCtxError,
  generateId
} from './context.server'

assertServerOnImport()

export interface HarnessData {
  response?: string
}

/** Result from harness including serialized context */
export interface HarnessResultScoped<T> extends HarnessResult<T> {
  /** Full UnifiedContext (can be serialized for session persistence) */
  context: UnifiedContext<T>
  /** Serialized context as JSON string */
  serialized: string
}

/**
 * Compose ConfiguredPatterns into a callable agent.
 *
 * @param patterns - ConfiguredPatterns to execute in sequence
 * @returns A function that processes input and returns full context
 *
 * @example
 * const agent = harness(
 *   simpleLoop(b.Neo4jController, tools.neo4j, { patternId: 'neo4j' }),
 *   synthesizer({ mode: 'response', patternId: 'synth' })
 * )
 *
 * const result = await agent('Show me all nodes')
 * // result.context contains full session state
 * // result.serialized can be stored for session persistence
 */
export function harness<T extends HarnessData & Record<string, unknown>>(
  ...patterns: ConfiguredPattern<T>[]
): (input: string, sessionId?: string, initialData?: Partial<T>, onEvent?: (event: ContextEvent) => void) => Promise<HarnessResultScoped<T>> {
  return async (input, sessionId, initialData, onEvent) => {
    const startTime = Date.now()

    // Create UnifiedContext
    const ctx = createContext<T>(input, initialData as T, sessionId)

    try {
      // Execute patterns using chain
      await runChain(ctx, patterns, onEvent)

      // Extract response from final data
      const response = ctx.data.response ?? ''

      // Add assistant message event if we have a response
      if (ctx.status === 'done' && response) {
        ctx.events.push({
          id: generateId('ev'),
          type: 'assistant_message',
          ts: Date.now(),
          patternId: 'harness',
          data: { content: response } as AssistantMessageEventData
        })
      }

      return {
        response,
        data: ctx.data,
        status: ctx.status,
        duration_ms: Date.now() - startTime,
        context: ctx,
        serialized: serializeContext(ctx)
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      setCtxError(ctx, msg, 'harness')

      return {
        response: `Error: ${msg}`,
        data: ctx.data,
        status: 'error' as CtxStatus,
        duration_ms: Date.now() - startTime,
        context: ctx,
        serialized: serializeContext(ctx)
      }
    }
  }
}

/**
 * Resume a paused harness from serialized context.
 *
 * @param serializedContext - The serialized UnifiedContext JSON
 * @param patterns - The original patterns
 * @param approved - Whether the action was approved
 * @returns The resumed result with updated context
 */
export async function resumeHarness<T extends HarnessData & Record<string, unknown> & { approved?: boolean }>(
  serializedContext: string,
  patterns: ConfiguredPattern<T>[],
  approved: boolean,
  onEvent?: (event: ContextEvent) => void
): Promise<HarnessResultScoped<T>> {
  // Restore context from serialized state
  const ctx = deserializeContext<T>(serializedContext)

  if (ctx.status !== 'paused') {
    throw new Error('Cannot resume: context is not paused')
  }

  const startTime = Date.now()

  // Set approval state and resume
  ctx.status = 'running'
  ctx.data = { ...ctx.data, approved }

  // Add approval response event
  ctx.events.push({
    id: generateId('ev'),
    type: 'approval_response',
    ts: Date.now(),
    patternId: 'harness',
    data: { approved }
  })

  try {
    // Re-run patterns - withApproval will handle the resume
    await runChain(ctx, patterns, onEvent)

    const response = ctx.data.response ?? ''
    const finalStatus = ctx.status as CtxStatus // chain may mutate ctx.status

    if (finalStatus === 'done' && response) {
      ctx.events.push({
        type: 'assistant_message',
        ts: Date.now(),
        patternId: 'harness',
        data: { content: response } as AssistantMessageEventData
      })
    }

    return {
      response,
      data: ctx.data,
      status: finalStatus,
      duration_ms: Date.now() - startTime,
      context: ctx,
      serialized: serializeContext(ctx)
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    setCtxError(ctx, msg, 'harness')

    return {
      response: `Error: ${msg}`,
      data: ctx.data,
      status: 'error' as CtxStatus,
      duration_ms: Date.now() - startTime,
      context: ctx,
      serialized: serializeContext(ctx)
    }
  }
}

/**
 * Continue a session from serialized context with new input.
 *
 * @param serializedContext - The serialized UnifiedContext JSON from previous session
 * @param patterns - The patterns to execute
 * @param newInput - New user input for this turn
 * @returns The result with updated context
 */
export async function continueSession<T extends HarnessData & Record<string, unknown>>(
  serializedContext: string,
  patterns: ConfiguredPattern<T>[],
  newInput: string,
  onEvent?: (event: ContextEvent) => void
): Promise<HarnessResultScoped<T>> {
  // Restore context from serialized state
  const ctx = deserializeContext<T>(serializedContext)

  const startTime = Date.now()

  // Update input and reset status for new turn
  ctx.input = newInput
  ctx.status = 'running'
  ctx.error = undefined

  // Clear stale error fields from data — errors are now event-scoped
  // and read via EventView, not carried forward in the data stash
  if (ctx.data && typeof ctx.data === 'object') {
    delete (ctx.data as Record<string, unknown>).hasError
    delete (ctx.data as Record<string, unknown>).errorMessage
  }

  // Add new user message event
  ctx.events.push({
    id: generateId('ev'),
    type: 'user_message',
    ts: Date.now(),
    patternId: 'harness',
    data: { content: newInput }
  })

  try {
    // Execute patterns
    await runChain(ctx, patterns, onEvent)

    const response = ctx.data.response ?? ''
    const finalStatus = ctx.status as CtxStatus // chain may mutate ctx.status

    if (finalStatus === 'done' && response) {
      ctx.events.push({
        type: 'assistant_message',
        ts: Date.now(),
        patternId: 'harness',
        data: { content: response } as AssistantMessageEventData
      })
    }

    return {
      response,
      data: ctx.data,
      status: finalStatus,
      duration_ms: Date.now() - startTime,
      context: ctx,
      serialized: serializeContext(ctx)
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    setCtxError(ctx, msg, 'harness')

    return {
      response: `Error: ${msg}`,
      data: ctx.data,
      status: 'error' as CtxStatus,
      duration_ms: Date.now() - startTime,
      context: ctx,
      serialized: serializeContext(ctx)
    }
  }
}
