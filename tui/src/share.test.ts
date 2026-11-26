import { expect, test } from 'bun:test'
import jsQR from 'jsqr'
import { generateKeypair } from '../../src/shared/keypair'
import { checksumAddress } from '../../src/shared/address'
import { conversationUrl } from '../../src/client/lib/address-links'
import { qrLines, qrModules, shareContent } from './share'

const address = generateKeypair().address
const link = conversationUrl(address, 'https://hushhash.org')

/** Reads the drawn lines back into an image, PIXELS per module, dark on light. */
function image(lines: string[], pixels = 4): { data: Uint8ClampedArray; width: number; height: number } {
  const width = lines[0]!.length * pixels
  const height = lines.length * 2 * pixels
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  lines.forEach((line, row) => [...line].forEach((cell, column) => {
    const dark = [cell === '▀' || cell === '█', cell === '▄' || cell === '█']
    dark.forEach((isDark, half) => {
      if (!isDark) return
      for (let y = 0; y < pixels; y++) for (let x = 0; x < pixels; x++) {
        const offset = (((row * 2 + half) * pixels + y) * width + column * pixels + x) * 4
        data[offset] = data[offset + 1] = data[offset + 2] = 0
      }
    })
  }))
  return { data, width, height }
}

test('the QR code has a row of cells for every two rows of modules, and scans as the link', () => {
  const modules = qrModules(link)
  expect(modules.length).toBe(37)
  expect(modules.every(row => row.length === 37)).toBe(true)
  const lines = qrLines(modules)
  expect(lines.length).toBe(Math.ceil(37 / 2))
  expect(lines.every(line => [...line].length === 37)).toBe(true)
  expect([...lines.join('')].every(cell => ' ▀▄█'.includes(cell))).toBe(true)
  const { data, width, height } = image(lines)
  expect(jsQR(data, width, height)?.data).toBe(link)
})

test('the QR code keeps a light quiet zone around it', () => {
  const modules = qrModules(link)
  for (const edge of [modules[0]!, modules[1]!, modules.at(-1)!, modules.map(row => row[0]!), modules.map(row => row.at(-1)!)]) {
    expect(edge.every(dark => !dark)).toBe(true)
  }
})

test('the Share panel shows the address and link, and the QR code only when it fits', () => {
  const details = { address, link }
  const big = shareContent(details, { columns: 80, rows: 40 }, { columns: 100, rows: 48 })
  const text = big.chunks.map(chunk => chunk.text).join('')
  expect(text).toContain(checksumAddress(address))
  expect(text).toContain(link)
  expect(text).toContain('█')
  // The code is dark on light whatever the theme.
  const code = big.chunks.find(chunk => chunk.text.includes('█'))!
  expect(code.bg?.toInts()).toEqual([255, 255, 255, 255])
  expect(code.fg?.toInts()).toEqual([0, 0, 0, 255])

  const small = shareContent(details, { columns: 60, rows: 18 }, { columns: 70, rows: 22 })
  const smallText = small.chunks.map(chunk => chunk.text).join('')
  expect(smallText).not.toContain('█')
  expect(smallText).toMatch(/Make the terminal at least 70×\d+ to show the QR code/)
  expect(smallText).toContain(link)
})
