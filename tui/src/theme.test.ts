import { afterEach, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { COLORS, PALETTES, parseThemeSetting, resolveTheme, setTheme, themeName } from './theme'

afterEach(() => setTheme('dark'))

test('system follows the terminal, dark when it does not say', () => {
  expect(resolveTheme('system', 'light')).toBe('light')
  expect(resolveTheme('system', 'dark')).toBe('dark')
  expect(resolveTheme('system', null)).toBe('dark')
  expect(resolveTheme('light', 'dark')).toBe('light')
  expect(parseThemeSetting('light')).toBe('light')
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
