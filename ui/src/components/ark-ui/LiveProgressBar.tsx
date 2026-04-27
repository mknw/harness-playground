/**
 * LiveProgressBar
 *
 * Transient progress indicator surfaced while a harness pattern is in flight.
 * Driven by live `controller_action` and `pattern_enter` events streamed from
 * the harness via the SSE endpoint.
 *
 * Behavior:
 *  - `pattern_enter` resets the bar; `data.maxTurns` (when present) sets the
 *    denominator. Defaults to a 5-step bar.
 *  - Each `controller_action` advances the bar by 1/maxTurns and crossfades
 *    the new `action.status` over the previous one.
 *  - When `visible` flips to false, the bar fills to 100%, fades out, and
 *    unmounts so the assistant message can take its place.
 */
import { Show, createSignal, createMemo, createEffect, on, onCleanup } from 'solid-js'
import { Progress } from '@ark-ui/solid/progress'

export interface LiveProgressBarProps {
  /** Most recent status string from a controller (already extracted upstream). */
  status: string | null
  /** 0..1 progress fraction. */
  progress: number
  /** Whether the bar should be shown. Flipping to false plays the exit animation. */
  visible: boolean
}

const STATUS_FADE_MS = 220
const EXIT_FADE_MS = 360

export const LiveProgressBar = (props: LiveProgressBarProps) => {
  // Two slots so the previous status crossfades out as the new one fades in.
  const [shownStatus, setShownStatus] = createSignal<string | null>(null)
  const [previousStatus, setPreviousStatus] = createSignal<string | null>(null)

  // Animated mount/unmount state — `mounted` controls render, `entering` toggles
  // the CSS transitions for both enter and exit.
  const [mounted, setMounted] = createSignal(false)
  const [entering, setEntering] = createSignal(false)

  let exitTimer: number | undefined
  let statusTimer: number | undefined

  onCleanup(() => {
    if (exitTimer !== undefined) clearTimeout(exitTimer)
    if (statusTimer !== undefined) clearTimeout(statusTimer)
  })

  // Crossfade when the status string changes (also covers the initial value).
  createEffect(
    on(
      () => props.status,
      (next, prev) => {
        if (next === prev) return
        if (statusTimer !== undefined) clearTimeout(statusTimer)
        setPreviousStatus((prev as string | null | undefined) ?? null)
        setShownStatus(next)
        statusTimer = window.setTimeout(() => {
          setPreviousStatus(null)
          statusTimer = undefined
        }, STATUS_FADE_MS)
      }
    )
  )

  // Mount/unmount with a delayed unmount so the CSS exit animation completes.
  // (Picks up the initial `visible` value too — no `defer: true`.)
  createEffect(
    on(
      () => props.visible,
      (next) => {
        if (exitTimer !== undefined) {
          clearTimeout(exitTimer)
          exitTimer = undefined
        }
        if (next) {
          setMounted(true)
          // Allow the next paint before flipping `entering` so the transition runs.
          requestAnimationFrame(() => setEntering(true))
        } else {
          setEntering(false)
          exitTimer = window.setTimeout(() => {
            setMounted(false)
            exitTimer = undefined
          }, EXIT_FADE_MS)
        }
      }
    )
  )

  // Bar value: 0–100. When exiting, animate to 100 to give a "completed" feel.
  const value = createMemo(() => {
    if (!props.visible) return 100
    return Math.max(0, Math.min(100, Math.round(props.progress * 100)))
  })

  return (
    <Show when={mounted()}>
      <div
        flex="~ col gap-1"
        px="4"
        py="2"
        border="t dark-border-primary"
        bg="dark-bg-tertiary/50"
        style={{
          opacity: entering() ? 1 : 0,
          transform: entering() ? 'translateY(0)' : 'translateY(4px)',
          transition: `opacity ${EXIT_FADE_MS}ms ease, transform ${EXIT_FADE_MS}ms ease`,
        }}
      >
        {/* Status line — two slots overlap during the crossfade */}
        <div
          flex="~ items-center gap-2"
          h="4"
          style={{ position: 'relative' }}
        >
          <div
            w="1.5"
            h="1.5"
            rounded="full"
            bg="neon-cyan"
            class="animate-pulse"
            style={{ 'flex-shrink': 0 }}
          />
          <Show when={previousStatus()}>
            <span
              text="xs dark-text-tertiary"
              style={{
                position: 'absolute',
                left: '14px',
                opacity: 0,
                transition: `opacity ${STATUS_FADE_MS}ms ease`,
                'pointer-events': 'none',
              }}
            >
              {previousStatus()}
            </span>
          </Show>
          <span
            text="xs dark-text-secondary"
            style={{
              opacity: shownStatus() ? 1 : 0,
              transition: `opacity ${STATUS_FADE_MS}ms ease`,
            }}
          >
            {shownStatus() ?? '\u00a0'}
          </span>
        </div>

        {/* Linear progress bar */}
        <Progress.Root value={value()} max={100} min={0}>
          <Progress.Track
            style={{
              height: '3px',
              'background-color': 'rgb(58, 58, 74)',
              'border-radius': '9999px',
              overflow: 'hidden',
            }}
          >
            <Progress.Range
              style={{
                height: '100%',
                'background-image':
                  'linear-gradient(90deg, rgba(0,255,255,0.85), rgba(157,0,255,0.85))',
                'box-shadow': '0 0 8px rgba(0,255,255,0.45)',
                transition: 'width 240ms cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            />
          </Progress.Track>
        </Progress.Root>
      </div>
    </Show>
  )
}
