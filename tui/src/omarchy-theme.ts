import { readFileSync, watch, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { PALETTES, type Palette, type Theme, type ThemeName } from './theme'

/** Where Omarchy keeps the colours of the theme in use. */
export function omarchyThemeDir(env: Record<string, string | undefined> = process.env): string {
  return join(env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'omarchy', 'current', 'theme')
}

/** Omarchy's `colors.toml` keys, each `#rrggbb`. */
type OmarchyColors = Record<string, string>

const HEX = /^#[0-9a-f]{6}$/i

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
}

/** `a` with `amount` (0–1) of `b` mixed in. */
function mix(a: string, b: string, amount: number): string {
  const [x, y] = [rgb(a), rgb(b)]
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * amount).toString(16).padStart(2, '0')).join('')}`
}

function hue(hex: string): number {
  const [r, g, b] = rgb(hex).map(v => v / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const delta = max - Math.min(r, g, b)
  if (delta === 0) return 0
  const h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  return (h * 60 + 360) % 360
}

function hueDistance(a: string, b: string): number {
  const d = Math.abs(hue(a) - hue(b))
  return Math.min(d, 360 - d)
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/**
 * The TUI's palette made from an Omarchy theme, or null when it lacks the
 * accent, background or foreground. Other missing colours come from the
 * built-in palette of the same mode.
 */
export function omarchyTheme(input: Record<string, unknown>): Theme | null {
  const colors: OmarchyColors = {}
  for (const [key, value] of Object.entries(input)) if (typeof value === 'string' && HEX.test(value)) colors[key] = value
  const { accent, background, foreground } = colors
  if (!accent || !background || !foreground) return null
  const name: ThemeName = input.mode === 'light' || input.mode === 'dark' ? input.mode : luminance(background) > 0.5 ? 'light' : 'dark'
  const base = PALETTES[name]
  // Your partner's colour stands apart from yours: the theme colour furthest round the hue circle from the accent.
  const candidates = ['orange', 'magenta', 'cyan', 'yellow', 'blue'].map(key => colors[key]).filter(value => value !== undefined)
  const them = candidates.reduce<string | undefined>((best, value) =>
    best === undefined || hueDistance(value, accent) > hueDistance(best, accent) ? value : best, undefined)
  const palette: Palette = {
    accent,
    muted: colors.dark_foreground ?? base.muted,
    text: foreground,
    selection: colors.selection ?? base.selection,
    you: accent,
    them: them ?? base.them,
    ok: colors.green ?? base.ok,
    error: colors.red ?? base.error,
    warning: colors.orange ?? colors.yellow ?? base.warning,
    border: colors.muted ?? base.border,
    surface: colors.dark_background ?? base.surface,
    backdrop: base.backdrop,
    onAccent: background,
    bubbleYou: mix(background, accent, name === 'dark' ? 0.2 : 0.14),
    bubbleThem: colors.lighter_background ?? base.bubbleThem,
  }
  return { name, palette }
}

/** The theme in `dir`, or null when there is none Omarchy-shaped to read. */
export function readOmarchyTheme(dir: string): Theme | null {
  try { return omarchyTheme(Bun.TOML.parse(readFileSync(join(dir, 'colors.toml'), 'utf8')) as Record<string, unknown>) }
  catch { return null }
}

/** The desktop's theme as it changes. */
export interface DesktopTheme {
  /** Null when Omarchy has no theme to read. */
  readonly current: Theme | null
  /** Calls `listener` after `current` changes; returns a function that stops it. */
  subscribe(listener: () => void): () => void
}

/**
 * Follows the Omarchy theme in `dir`. A theme switch replaces the theme
 * directory as well as the files in it, so both it and its parent are
 * watched, and the watchers are made again after every change.
 */
export class OmarchyThemeWatcher implements DesktopTheme {
  current: Theme | null
  private readonly listeners = new Set<() => void>()
  private watchers: FSWatcher[] = []
  private pending: ReturnType<typeof setTimeout> | undefined
  private closed = false

  constructor(private readonly dir: string = omarchyThemeDir(), private readonly settleMs = 100) {
    this.current = readOmarchyTheme(dir)
    this.arm()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close(): void {
    this.closed = true
    clearTimeout(this.pending)
    this.disarm()
    this.listeners.clear()
  }

  private arm(): void {
    this.disarm()
    for (const path of [this.dir, dirname(this.dir)]) {
      try {
        const watcher = watch(path, () => this.changed())
        // A directory that goes away ends its watcher with an error; the next change makes a new one.
        watcher.on('error', () => {})
        this.watchers.push(watcher)
      } catch {
        // Not there (yet): without Omarchy there is nothing to follow.
      }
    }
  }

  private disarm(): void {
    for (const watcher of this.watchers) watcher.close()
    this.watchers = []
  }

  /** A switch writes several files; read once they have settled. */
  private changed(): void {
    clearTimeout(this.pending)
    this.pending = setTimeout(() => {
      if (this.closed) return
      this.arm()
      const next = readOmarchyTheme(this.dir)
      // Mid-switch the files can be briefly missing; keep the last theme rather than flicker.
      if (!next || JSON.stringify(next) === JSON.stringify(this.current)) return
      this.current = next
      for (const listener of this.listeners) listener()
    }, this.settleMs)
  }
}
