import { RGBA, StyledText, type OptimizedBuffer, type TerminalCapabilities, type TextChunk } from '@opentui/core'
import { identifierToSvg } from 'glyphid'
import type { Address } from '../../src/shared/address'
import type { ThemeName } from './theme'

/** A mosaic is this many tiles across and down. */
export const AVATAR_TILES = 4
/** Columns an avatar takes; each cell shows two tiles stacked with a half block. */
export const AVATAR_COLUMNS = AVATAR_TILES

/** Tile colours, row by row from the top. */
export type AvatarGrid = readonly (readonly string[])[]

const TILE = /<g transform="translate\((\d+),(\d+)\)"><g [^>]*>(.*?)<\/g><\/g>/g
const FILL = /fill="(#[0-9a-f]{6})"/g
// The one tile shape whose base colour, not its overlay, is the main colour.
const TRIANGLE = 'd="M0 32L32 0V32Z"'

const cache = new Map<string, AvatarGrid>()

/**
 * The browser's glyphid mosaic for `address` as a 4×4 grid of colours:
 * each tile's main colour, without its shape. The same address always gives
 * the same grid, like the browser's avatar in the same theme.
 */
export function avatarGrid(address: Address, theme: ThemeName): AvatarGrid {
  const key = `${theme}:${address}`
  const cached = cache.get(key)
  if (cached) return cached
  const svg = identifierToSvg(address, { variant: 'mosaic', theme, size: 16, decorative: true })
  const grid = Array.from({ length: AVATAR_TILES }, () => Array<string>(AVATAR_TILES).fill(''))
  for (const [, x, y, tile] of svg.matchAll(TILE)) {
    const fills = [...tile!.matchAll(FILL)].map(match => match[1]!)
    const main = fills.length > 1 && !tile!.includes(TRIANGLE) ? fills[1]! : fills[0]!
    // Tiles start 16 units in and are 32 apart.
    grid[(Number(y) - 16) / 32]![(Number(x) - 16) / 32] = main
  }
  if (grid.some(row => row.some(color => !color))) throw new Error('Unexpected glyphid mosaic')
  cache.set(key, grid)
  return grid
}

/**
 * Whether the terminal can show an avatar's colours. Unknown capabilities
 * count as yes, since most terminals have at least 256 colours; a terminal
 * with only the basic 16 would turn every avatar into the same few blocks.
 */
export function canDrawAvatars(capabilities: TerminalCapabilities | null): boolean {
  return capabilities === null || capabilities.rgb || capabilities.ansi256
}

const UPPER_HALF = '▀'

/**
 * The avatar's two rows of cells as styled text: each cell's top half is one
 * tile and its bottom half the tile below.
 */
export function avatarRows(grid: AvatarGrid): StyledText[] {
  const rows: StyledText[] = []
  for (let row = 0; row < AVATAR_TILES; row += 2) {
    rows.push(new StyledText(grid[row]!.map((top, column): TextChunk => ({
      __isChunk: true, text: UPPER_HALF, fg: RGBA.fromHex(top), bg: RGBA.fromHex(grid[row + 1]![column]!),
    }))))
  }
  return rows
}

/** One row: the avatar's top half, for a one-line bar. */
export function avatarLine(grid: AvatarGrid): StyledText {
  return avatarRows(grid)[0]!
}

/** Draws the whole avatar at (`x`, `y`), two rows tall. */
export function drawAvatar(buffer: OptimizedBuffer, grid: AvatarGrid, x: number, y: number): void {
  for (let row = 0; row < AVATAR_TILES; row += 2) {
    for (let column = 0; column < AVATAR_TILES; column++) {
      buffer.setCell(x + column, y + row / 2, UPPER_HALF, RGBA.fromHex(grid[row]![column]!), RGBA.fromHex(grid[row + 1]![column]!))
    }
  }
}
