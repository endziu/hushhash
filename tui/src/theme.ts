import { RenderableEvents, type BoxRenderable, type Renderable } from '@opentui/core'

/** The palette every component draws with. */
export const COLORS = {
  accent: '#7aa2f7',
  muted: '#737aa2',
  text: '#c0caf5',
  selection: '#292e42',
  you: '#9ece6a',
  them: '#e0af68',
  error: '#f7768e',
  border: '#3b4261',
  /** Behind dialogs and toasts, so they cover what is under them. */
  surface: '#1f2335',
  /** Dims the screen behind an open dialog. */
  backdrop: '#00000080',
  /** Text on an accent or error background. */
  onAccent: '#1a1b26',
}

/** Stacking order of what is drawn above the layout. */
export const LAYERS = {
  modal: 100,
  /** The hint bar, above a dialog's backdrop since it shows the dialog's keys. */
  hints: 150,
  toasts: 200,
}

/** Runs `listener` whenever `target` gains or loses focus. */
export function onFocusChange(target: Renderable, listener: (focused: boolean) => void): void {
  target.on(RenderableEvents.FOCUSED, () => listener(true))
  target.on(RenderableEvents.BLURRED, () => listener(false))
}

/** Lights `frame`'s border while `inner` has focus. */
export function highlightOnFocus(frame: BoxRenderable, inner: Renderable): void {
  onFocusChange(inner, focused => { frame.borderColor = focused ? COLORS.accent : COLORS.border })
}
