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

/** Lights `frame`'s border while `inner` has focus. */
export function highlightOnFocus(frame: BoxRenderable, inner: Renderable): void {
  inner.on(RenderableEvents.FOCUSED, () => { frame.borderColor = COLORS.accent })
  inner.on(RenderableEvents.BLURRED, () => { frame.borderColor = COLORS.border })
}
