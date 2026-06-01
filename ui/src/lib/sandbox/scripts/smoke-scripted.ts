/**
 * LLM-free smoke test for `withSandbox(actorCritic(...))`.
 *
 * Drives a real `DockerBackend` booting a real `kg-sandbox:base` container,
 * but hand-scripts the actor + critic instead of calling BAML. Proves the
 * wrapper, ALS scope, `callTool` dispatch, and DockerBackend lifecycle work
 * end-to-end against a live container, with zero LLM cost or API key.
 *
 * Prerequisites:
 *   - Docker engine running (colima on macOS).
 *   - `kg-sandbox:base` image built:
 *       cd rootfs && docker build -t kg-sandbox:base .
 *     (Inside the nix shell, the flake's shellHook bridges
 *     ~/.docker/contexts. See rootfs/README.md → "Inside the nix shell".)
 *
 * Run from `ui/`:
 *   pnpm dlx tsx src/lib/sandbox/scripts/smoke-scripted.ts
 *
 * Expected: the actor writes a Python script counting words in a fixed
 * sentence; the in-VM `sandbox_bash` runs it; the critic accepts; the
 * script prints the count (9) plus an event log.
 */

import { withSandbox } from '../with-sandbox.server'
import { actorCritic } from '../../harness-patterns/patterns/actorCritic.server'
import { createScope } from '../../harness-patterns/context.server'
import { createEventView } from '../../harness-patterns/patterns'
import type {
  CodeModeControllerFnWithLLMData,
  CriticFnWithLLMData,
} from '../../harness-patterns/baml-adapters.server'
import { printEventSummary, checkRootfsImage } from './_shared'

const SENTENCE = 'the quick brown fox jumps over the lazy dog'
const SCRIPT = `text = "${SENTENCE}"\nprint(len(text.split()))\n`

// Scripted actor: turn 1 writes `/work/count.py`, turn 2 runs it via bash.
let actorCalls = 0
const scriptedActor: CodeModeControllerFnWithLLMData = async () => {
  actorCalls += 1
  if (actorCalls === 1) {
    return {
      action: {
        reasoning: 'Write the word-count script to /work/count.py.',
        tool_name: 'sandbox_write',
        tool_args: JSON.stringify({ path: '/work/count.py', content: SCRIPT }),
        status: 'success',
        is_final: false,
      },
    }
  }
  return {
    action: {
      reasoning: 'Run the script with python3.',
      tool_name: 'sandbox_bash',
      tool_args: JSON.stringify({ command: 'python3 /work/count.py' }),
      status: 'success',
      is_final: false,
    },
  }
}

// Scripted critic: rejects after the write (needs to see a result), accepts
// after the bash returns the count.
let criticCalls = 0
const scriptedCritic: CriticFnWithLLMData = async () => {
  criticCalls += 1
  return {
    result: {
      is_sufficient: criticCalls >= 2,
      explanation:
        criticCalls === 1
          ? 'Script written but not yet executed.'
          : 'Got the word count.',
      suggested_approach: criticCalls === 1 ? 'Run it with python3.' : undefined,
    },
  }
}

async function main(): Promise<void> {
  console.log('🚀 LLM-free sandbox smoke — scripted actor/critic')
  console.log(`   sentence: "${SENTENCE}"`)
  console.log(`   expected word count: ${SENTENCE.split(/\s+/).length}`)

  await checkRootfsImage()

  const pattern = withSandbox({ rootfs: 'base' })(
    actorCritic(scriptedActor, scriptedCritic, [], {
      availableTools: [],
      maxRetries: 3,
      patternId: 'smoke-scripted',
      trackHistory: true,
    }),
  )

  const scope = createScope('smoke-scripted', { intent: 'count the words' })
  const view = createEventView({
    sessionId: 'smoke-scripted',
    createdAt: Date.now(),
    events: [
      {
        type: 'user_message' as const,
        ts: Date.now(),
        patternId: 'harness',
        data: { content: `count the words in: ${SENTENCE}` },
      },
    ],
    status: 'running' as const,
    data: {},
    input: `count the words in: ${SENTENCE}`,
  })

  console.log('\n⏳ booting sandbox + running pattern...')
  const t0 = Date.now()
  const out = await pattern.fn(scope, view)
  const elapsedMs = Date.now() - t0

  printEventSummary(out)
  const final = (out.data as { result?: unknown }).result
  console.log(`📦 final result: ${JSON.stringify(final)}`)
  console.log(`⏱  elapsed: ${elapsedMs}ms`)
  console.log(`👣 actor calls: ${actorCalls}, critic calls: ${criticCalls}`)
}

main().catch((err) => {
  console.error('\n❌ smoke failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
