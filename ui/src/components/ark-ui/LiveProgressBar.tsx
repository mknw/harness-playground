/**
 * LiveProgressBar
 *
 * Inline status bar surfaced while a harness chain is in flight.
 *
 * Layout (top → bottom):
 *   [pulse dot]  status text          current/total
 *   [───────────────────────────────────────────────] linear progress
 *
 * The status string crossfades when it changes; `current/total` updates via
 * the `Progress.ValueText` slot. When `visible` flips false the bar fills to
 * 100%, fades out, and unmounts so the assistant message can take its place.
 *
 * Built from Ark UI's `Progress` primitives (Root/Track/Range/Label/ValueText)
 * with UnoCSS attributify for layout. Runtime visual state (gradient fill,
 * crossfade, exit) lives in inline styles because UnoCSS attributify doesn't
 * support per-frame transitions.
 */
import { Show, createSignal, createMemo, createEffect, on, onCleanup } from 'solid-js'
import { Progress } from '@ark-ui/solid/progress'

export interface LiveProgressBarProps {
  status: string | null
  /** Cumulative turn position (1-based when active, 0 before first event). */
  current: number
  /** Best-effort chain total. May grow as pattern_enter events arrive. */
  total: number
  /** Whether the bar should be shown. Flipping to false plays the exit animation. */
  visible: boolean
}

const STATUS_FADE_MS = 220
const EXIT_FADE_MS = 360

export const LiveProgressBar = (props: LiveProgressBarProps) => {
  const [shownStatus, setShownStatus] = createSignal<string | null>(null)
  const [previousStatus, setPreviousStatus] = createSignal<string | null>(null)
  const [mounted, setMounted] = createSignal(false)
  const [entering, setEntering] = createSignal(false)

  let exitTimer: number | undefined
  let statusTimer: number | undefined

  onCleanup(() => {
    if (exitTimer !== undefined) clearTimeout(exitTimer)
    if (statusTimer !== undefined) clearTimeout(statusTimer)
  })

  // Crossfade when the status string changes.
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

  const total = createMemo(() => Math.max(1, props.total))
  const value = createMemo(() => {
    if (!props.visible) return total()
    return Math.max(0, Math.min(props.current, total()))
  })
  const percent = createMemo(() => Math.round((value() / total()) * 100))
  const valueText = createMemo(() => `${value()}/${total()}`)

  return (
    <Show when={mounted()}>
      <div
        flex="~ col gap-1.5"
        px="4"
        py="2.5"
        border="t dark-border-primary"
        bg="dark-bg-tertiary/50"
        style={{
          opacity: entering() ? 1 : 0,
          transform: entering() ? 'translateY(0)' : 'translateY(4px)',
          transition: `opacity ${EXIT_FADE_MS}ms ease, transform ${EXIT_FADE_MS}ms ease`,
        }}
      >
        <Progress.Root
          value={value()}
          min={0}
          max={total()}
          flex="~ col gap-1.5"
        >
          {/* Header row: pulse + status + counter */}
          <div flex="~ items-center gap-2" h="4" style={{ position: 'relative' }}>
            <div
              w="1.5"
              h="1.5"
              rounded="full"
              bg="neon-cyan"
              class="animate-pulse"
              style={{ 'flex-shrink': 0 }}
            />

            {/* Status slot — two children overlap during crossfade */}
            <div flex="~ 1" style={{ position: 'relative', 'min-width': 0 }}>
              <Show when={previousStatus()}>
                <Progress.Label
                  text="xs dark-text-tertiary"
                  truncate=""
                  style={{
                    position: 'absolute',
                    inset: 0,
                    opacity: 0,
                    transition: `opacity ${STATUS_FADE_MS}ms ease`,
                    'pointer-events': 'none',
                  }}
                >
                  {previousStatus()}
                </Progress.Label>
              </Show>
              <Progress.Label
                text="xs dark-text-secondary"
                truncate=""
                style={{
                  display: 'block',
                  opacity: shownStatus() ? 1 : 0,
                  transition: `opacity ${STATUS_FADE_MS}ms ease`,
                }}
              >
                {shownStatus() ?? '\u00a0'}
              </Progress.Label>
            </div>

            <Progress.ValueText
              text="xs dark-text-tertiary tabular-nums"
              style={{ 'flex-shrink': 0, 'font-variant-numeric': 'tabular-nums' }}
            >
              {valueText()}
            </Progress.ValueText>
          </div>

          {/* Linear bar */}
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
                width: `${percent()}%`,
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
