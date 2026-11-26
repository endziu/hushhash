import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PALETTES } from './theme'
import { OmarchyThemeWatcher, omarchyTheme, omarchyThemeDir, readOmarchyTheme } from './omarchy-theme'

const CATPPUCCIN = {
  mode: 'dark', accent: '#89b4fa', selection: '#45475a', muted: '#585b70',
  background: '#1e1e2e', dark_background: '#161622', lighter_background: '#313244',
  foreground: '#cdd6f4', dark_foreground: '#6c7086',
  red: '#f38ba8', yellow: '#f9e2af', orange: '#f6b6ab', green: '#a6e3a1', cyan: '#94e2d5', blue: '#89b4fa', magenta: '#f5c2e7',
}

function toml(colors: Record<string, string>): string {
  return Object.entries(colors).map(([key, value]) => `${key} = "${value}"`).join('\n')
}

const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup() })

/** A state directory holding `current/theme/colors.toml`, as Omarchy lays it out. */
function stateDir(colors: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'hushhash-omarchy-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const dir = omarchyThemeDir({ XDG_STATE_HOME: root })
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'colors.toml'), toml(colors))
  return dir
}

test('the desktop theme maps onto every token', () => {
  const theme = omarchyTheme(CATPPUCCIN)!
  expect(theme.name).toBe('dark')
  expect(Object.keys(theme.palette).sort()).toEqual(Object.keys(PALETTES.dark).sort())
  for (const value of Object.values(theme.palette)) expect(value).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i)
  expect(theme.palette).toMatchObject({
    accent: '#89b4fa', you: '#89b4fa', text: '#cdd6f4', muted: '#6c7086', border: '#585b70',
    ok: '#a6e3a1', error: '#f38ba8', onAccent: '#1e1e2e', surface: '#161622', bubbleThem: '#313244',
  })
  // Blue accent: the partner gets the theme colour furthest from it, not another blue.
  expect(theme.palette.them).toBe('#f9e2af')
  // Your bubbles are the background tinted toward the accent.
  expect(theme.palette.bubbleYou).not.toBe(CATPPUCCIN.background)
})

test('a theme without its main colours is not used, and a missing mode comes from the background', () => {
  expect(omarchyTheme({ ...CATPPUCCIN, accent: undefined })).toBeNull()
  expect(omarchyTheme({ ...CATPPUCCIN, background: 'blue' })).toBeNull()
  const light = omarchyTheme({ accent: '#1e66f5', background: '#eff1f5', foreground: '#4c4f69' })!
  expect(light.name).toBe('light')
  expect(light.palette.ok).toBe(PALETTES.light.ok)
})

test('reading a missing or broken theme gives none', () => {
  expect(readOmarchyTheme(join(tmpdir(), 'hushhash-no-such-theme'))).toBeNull()
  const dir = stateDir(CATPPUCCIN)
  writeFileSync(join(dir, 'colors.toml'), 'accent = ')
  expect(readOmarchyTheme(dir)).toBeNull()
})

test('the watcher follows a theme rewritten in place and a theme directory replaced', async () => {
  const dir = stateDir(CATPPUCCIN)
  const watcher = new OmarchyThemeWatcher(dir, 20)
  cleanups.push(() => watcher.close())
  let changes = 0
  watcher.subscribe(() => { changes++ })
  expect(watcher.current?.palette.accent).toBe('#89b4fa')

  writeFileSync(join(dir, 'colors.toml'), toml({ ...CATPPUCCIN, accent: '#e6c568' }))
  await until(() => watcher.current?.palette.accent === '#e6c568')
  expect(changes).toBe(1)

  // A theme switch puts a new directory in place of the old one.
  const next = `${dir}.next`
  mkdirSync(next)
  writeFileSync(join(next, 'colors.toml'), toml({ ...CATPPUCCIN, accent: '#7d82d9' }))
  rmSync(dir, { recursive: true })
  renameSync(next, dir)
  await until(() => watcher.current?.palette.accent === '#7d82d9')

  // And the watcher was re-armed on the new directory.
  writeFileSync(join(dir, 'colors.toml'), toml({ ...CATPPUCCIN, mode: 'light', background: '#eff1f5', accent: '#1e66f5' }))
  await until(() => watcher.current?.name === 'light')
})

test('without Omarchy there is nothing to follow', () => {
  const watcher = new OmarchyThemeWatcher(join(tmpdir(), 'hushhash-no-such-state', 'omarchy', 'current', 'theme'))
  expect(watcher.current).toBeNull()
  watcher.close()
})

async function until(check: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out')
    await Bun.sleep(10)
  }
}
