import { afterEach, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { COLORS, PALETTES, followsTerminal, parseThemeSetting, resolveTheme, setTheme, themeName } from './theme'

afterEach(() => setTheme('dark'))

test('system follows the terminal, dark when it does not say', () => {
  expect(resolveTheme('system', 'light').name).toBe('light')
  expect(resolveTheme('system', 'dark').name).toBe('dark')
  expect(resolveTheme('system', null)).toEqual({ name: 'dark', palette: PALETTES.dark })
  expect(resolveTheme('light', 'dark').name).toBe('light')
  expect(parseThemeSetting('light')).toBe('light')
  expect(parseThemeSetting('omarchy')).toBe('omarchy')
  expect(parseThemeSetting('sepia')).toBeNull()
})

test('switching swaps the palette in place, with every token in both', () => {
  expect(Object.keys(PALETTES.light).sort()).toEqual(Object.keys(PALETTES.dark).sort())
  const palette = COLORS
  setTheme('light')
  expect(themeName()).toBe('light')
  expect(palette).toEqual({ ...PALETTES.light })
  setTheme('dark')
  expect(palette).toEqual({ ...PALETTES.dark })
})

test('no colour is written outside the theme module', () => {
  const dir = import.meta.dir
  const offenders = readdirSync(dir)
    .filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts') && file !== 'theme.ts')
    .filter(file => /['"]#[0-9a-fA-F]{3,8}['"]/.test(readFileSync(join(dir, file), 'utf8')))
  expect(offenders).toEqual([])
})

test('omarchy uses the desktop theme, and follows the terminal while there is none', () => {
  const desktop = { name: 'light' as const, palette: PALETTES.light }
  expect(resolveTheme('omarchy', 'dark', desktop)).toBe(desktop)
  expect(resolveTheme('omarchy', 'light', null).name).toBe('light')
  expect(resolveTheme('dark', 'light', desktop).name).toBe('dark')
  expect(followsTerminal('omarchy', null)).toBe(true)
  expect(followsTerminal('omarchy', desktop)).toBe(false)
  expect(followsTerminal('system', desktop)).toBe(true)
  expect(followsTerminal('dark', null)).toBe(false)
})
