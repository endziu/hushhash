import { BoxRenderable, TextRenderable, fg, t, type CliRenderer, type Renderable } from '@opentui/core'
import { COLORS, LAYERS } from './theme'

export type ToastKind = 'info' | 'success' | 'error'

const DURATION_MS: Record<ToastKind, number> = { info: 4000, success: 4000, error: 8000 }
const MAX_TOASTS = 4
const STYLE: Record<ToastKind, { color: string; icon: string }> = {
  info: { color: COLORS.accent, icon: 'ℹ' },
  success: { color: COLORS.you, icon: '✓' },
  error: { color: COLORS.error, icon: '✗' },
}

/**
 * Short-lived notices stacked in the top-right corner, under the pane title, above everything
 * else. Each disappears after a few seconds, or when clicked; past four,
 * the oldest goes first.
 */
export class Toasts {
  private readonly stack: BoxRenderable
  private readonly timers = new Map<BoxRenderable, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly renderer: CliRenderer,
    parent: Renderable,
    private readonly duration: (kind: ToastKind) => number = kind => DURATION_MS[kind],
  ) {
    this.stack = new BoxRenderable(renderer, {
      position: 'absolute', top: 2, right: 2, zIndex: LAYERS.toasts, maxWidth: '60%',
      flexDirection: 'column', alignItems: 'flex-end',
    })
    parent.add(this.stack)
  }

  show(text: string, kind: ToastKind = 'info'): void {
    const { color, icon } = STYLE[kind]
    const toast = new BoxRenderable(this.renderer, {
      maxWidth: 60, paddingX: 1, flexShrink: 0,
      border: true, borderStyle: 'rounded', borderColor: color, backgroundColor: COLORS.surface,
      onMouseDown: event => {
        event.preventDefault()
        this.dismiss(toast)
      },
    })
    toast.add(new TextRenderable(this.renderer, { content: t`${fg(color)(icon)} ${text}`, wrapMode: 'word', fg: COLORS.text }))
    this.stack.add(toast)
    this.timers.set(toast, setTimeout(() => this.dismiss(toast), this.duration(kind)))
    while (this.timers.size > MAX_TOASTS) this.dismiss(this.timers.keys().next().value!)
  }

  dismiss(toast: BoxRenderable): void {
    const timer = this.timers.get(toast)
    if (timer === undefined) return
    clearTimeout(timer)
    this.timers.delete(toast)
    this.stack.remove(toast)
    toast.destroyRecursively()
  }

  /** Stops every timer; for shutting down. */
  dispose(): void {
    for (const toast of this.timers.keys()) this.dismiss(toast)
  }
}
