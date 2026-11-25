import { RenderableEvents, type BoxRenderable, type Renderable, type ThemeMode } from '@opentui/core'

/** The semantic colours every component draws with. */
export interface Palette {
  accent: string
  muted: string
  text: string
  selection: string
  /** Your name and messages. */
  you: string
  /** Your conversation partner's name and messages. */
  them: string
  /** Connected, saved, done. */
  ok: string
  error: string
  /** Running out soon, retrying. */
  warning: string
  border: string
  /** Behind dialogs and toasts, so they cover what is under them. */
  surface: string
  /** Dims the screen behind an open dialog. */
  backdrop: string
  /** Text on an accent or error background. */
  onAccent: string
  /** Behind your messages. */
  bubbleYou: string
  /** Behind your partner's messages. */
  bubbleThem: string
}

export type ThemeName = ThemeMode

/** What the user chose: a palette, or whatever the terminal background suits. */
export type ThemeSetting = ThemeName | 'system'

export const THEME_SETTINGS: readonly ThemeSetting[] = ['system', 'light', 'dark']

/** Warm palettes in the spirit of the browser's. */
export const PALETTES: Record<ThemeName, Readonly<Palette>> = {
  dark: {
    accent: '#9a9df5',
    muted: '#958f86',
    text: '#edeae5',
    selection: '#33302c',
    you: '#a9acff',
    them: '#e3b778',
    ok: '#6fd08c',
    error: '#ff8a7a',
    warning: '#f0a35a',
    border: '#4a4642',
    surface: '#1c1b19',
    backdrop: '#00000080',
    onAccent: '#15163a',
    bubbleYou: '#2c2d55',
    bubbleThem: '#2b2926',
  },
  light: {
    accent: '#4f52c9',
    muted: '#66615a',
    text: '#1e1d1b',
    selection: '#e2ded7',
    you: '#4346b8',
    them: '#8a5410',
    ok: '#2f8a4a',
    error: '#c0342b',
    warning: '#a85a00',
    border: '#c9c4bb',
    surface: '#fbfaf8',
    backdrop: '#00000040',
    onAccent: '#ffffff',
    bubbleYou: '#e3e3f6',
    bubbleThem: '#ebe8e3',
  },
}

/**
 * The palette in use. Components read it whenever they draw, and
 * `setTheme` swaps its values in place, so nothing holds a stale copy.
 */
export const COLORS: Palette = { ...PALETTES.dark }

let current: ThemeName = 'dark'

/** The palette in use. */
export function themeName(): ThemeName {
  return current
}

/** Switches the palette. Components pick it up when they next draw. */
export function setTheme(name: ThemeName): void {
  current = name
  Object.assign(COLORS, PALETTES[name])
}

export function parseThemeSetting(value: string): ThemeSetting | null {
  return (THEME_SETTINGS as readonly string[]).includes(value) ? value as ThemeSetting : null
}

/** The palette for `setting`; `system` follows the terminal, dark when it does not say. */
export function resolveTheme(setting: ThemeSetting, terminal: ThemeMode | null): ThemeName {
  return setting === 'system' ? terminal ?? 'dark' : setting
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

/**
 * Lights `frame`'s border while `inner` has focus. Returns a repaint, for
 * after the palette changes.
 */
export function highlightOnFocus(frame: BoxRenderable, inner: Renderable): () => void {
  const paint = () => { frame.borderColor = inner.focused ? COLORS.accent : COLORS.border }
  onFocusChange(inner, paint)
  paint()
  return paint
}
