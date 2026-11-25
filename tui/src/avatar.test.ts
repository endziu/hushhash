import { expect, test } from 'bun:test'
import { RGBA } from '@opentui/core'
import { createTerminalCapabilities } from '@opentui/core/testing'
import { generateKeypair } from '../../src/shared/keypair'
import { AVATAR_TILES, avatarGrid, avatarRows, canDrawAvatars } from './avatar'

const HEX = /^#[0-9a-f]{6}$/

test('the same address always gives the same mosaic, and different addresses differ', () => {
  const [first, second] = [generateKeypair().address, generateKeypair().address]
  const grid = avatarGrid(first, 'dark')
  expect(grid).toHaveLength(AVATAR_TILES)
  for (const row of grid) {
    expect(row).toHaveLength(AVATAR_TILES)
    for (const color of row) expect(color).toMatch(HEX)
  }
  // A fixed address gives a fixed mosaic, across runs and identities.
  expect(avatarGrid('0x1234567890abcdef1234567890abcdef12345678' as never, 'dark')[0]).toEqual(['#ca4997', '#ceb0e3', '#8d3a7f', '#8d3a7f'])
  expect(avatarGrid(first, 'dark')).toEqual(grid)
  expect(avatarGrid(second, 'dark')).not.toEqual(grid)
  // Each theme has its own colours, like the browser's.
  expect(avatarGrid(first, 'light')).not.toEqual(grid)
})

test('an avatar is two rows of half blocks, a tile above and a tile below', () => {
  const grid = avatarGrid(generateKeypair().address, 'dark')
  const rows = avatarRows(grid)
  expect(rows).toHaveLength(2)
  const first = rows[0]!.chunks[0]!
  expect(first.text).toBe('▀')
  expect(first.fg?.toInts()).toEqual(RGBA.fromHex(grid[0]![0]!).toInts())
  expect(first.bg?.toInts()).toEqual(RGBA.fromHex(grid[1]![0]!).toInts())
})

test('avatars need at least 256 colours', () => {
  expect(canDrawAvatars(null)).toBe(true)
  expect(canDrawAvatars(createTerminalCapabilities({ rgb: true, ansi256: false }))).toBe(true)
  expect(canDrawAvatars(createTerminalCapabilities({ rgb: false, ansi256: true }))).toBe(true)
  expect(canDrawAvatars(createTerminalCapabilities({ rgb: false, ansi256: false }))).toBe(false)
})
