import { afterEach, beforeEach, expect, test } from 'bun:test'
import { BoxRenderable } from '@opentui/core'
import { createTestRenderer } from '@opentui/core/testing'
import { Toasts } from './toasts'

let setup: Awaited<ReturnType<typeof createTestRenderer>>
let toasts: Toasts

beforeEach(async () => {
  setup = await createTestRenderer({ width: 80, height: 24 })
  const root = new BoxRenderable(setup.renderer, { width: '100%', height: '100%' })
  setup.renderer.root.add(root)
  toasts = new Toasts(setup.renderer, root, kind => kind === 'error' ? 200 : 100)
})

afterEach(() => {
  toasts.dispose()
  setup.renderer.destroy()
})

async function frame(): Promise<string> {
  await setup.renderOnce()
  return setup.captureCharFrame()
}

test('a toast shows in the top-right corner and disappears after its time', async () => {
  toasts.show('Lifetime set', 'success')
  const lines = (await frame()).split('\n')
  const row = lines.findIndex(line => line.includes('Lifetime set'))
  expect(row).toBeGreaterThan(0)
  expect(lines[row]!.indexOf('Lifetime set')).toBeGreaterThan(40)
  expect(lines[row]).toContain('✓')
  await Bun.sleep(150)
  expect(await frame()).not.toContain('Lifetime set')
})

test('errors stay longer than other toasts', async () => {
  toasts.show('Send failed', 'error')
  toasts.show('Saved')
  await Bun.sleep(150)
  expect(await frame()).toContain('Send failed')
  expect(await frame()).not.toContain('Saved')
  await Bun.sleep(100)
  expect(await frame()).not.toContain('Send failed')
})

test('toasts stack, newest last, and only the four newest stay', async () => {
  for (const name of ['one', 'two', 'three', 'four', 'five']) toasts.show(`toast ${name}`)
  const screen = await frame()
  expect(screen).not.toContain('toast one')
  const rows = ['two', 'three', 'four', 'five'].map(name => screen.split('\n').findIndex(line => line.includes(`toast ${name}`)))
  expect(rows).toEqual([...rows].sort((a, b) => a - b))
  expect(rows.every(row => row > 0)).toBe(true)
})

test('a click dismisses a toast', async () => {
  toasts.show('click me')
  const lines = (await frame()).split('\n')
  const y = lines.findIndex(line => line.includes('click me'))
  await setup.mockMouse.click(lines[y]!.indexOf('click me'), y)
  expect(await frame()).not.toContain('click me')
})
