import { expect, test } from 'bun:test'
import { TerminalAttention } from './attention'

function track(idleMs: number) {
  const changes: boolean[] = []
  const attention = new TerminalAttention(attentive => changes.push(attentive), idleMs)
  return { attention, changes }
}

test('without focus reports, attention lapses after idle time and input restores it', async () => {
  const { attention, changes } = track(40)
  expect(attention.attentive).toBe(true)
  await Bun.sleep(25)
  attention.input()
  await Bun.sleep(25)
  expect(attention.attentive).toBe(true)
  await Bun.sleep(40)
  expect(attention.attentive).toBe(false)
  attention.input()
  expect(changes).toEqual([false, true])
  attention.dispose()
})

test('once the terminal reports focus, focus alone decides', async () => {
  const { attention, changes } = track(20)
  attention.focus()
  await Bun.sleep(50)
  expect(attention.attentive).toBe(true)
  attention.blur()
  expect(attention.attentive).toBe(false)
  attention.focus()
  expect(changes).toEqual([false, true])
  attention.dispose()
})
