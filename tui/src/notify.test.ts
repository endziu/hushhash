import { expect, test } from 'bun:test'
import { NOTIFICATION_MESSAGE, NOTIFICATION_TITLE, NOTIFY_INTERVAL_MS, Notifier, terminalTitle, totalUnread, type NotifyTerminal } from './notify'

function terminal(supported: boolean) {
  const calls: string[] = []
  const fake: NotifyTerminal = {
    notify: (title, message) => { calls.push(`notify ${title}: ${message}`); return supported },
    bell: () => { calls.push('bell') },
  }
  return { fake, calls }
}

test('a notification says nothing about the message', () => {
  expect(NOTIFICATION_TITLE).toBe('hushhash')
  expect(NOTIFICATION_MESSAGE).toBe('New message')
})

test('a burst makes one notification, and the next comes after the interval', () => {
  let now = 1_000_000
  const { fake, calls } = terminal(true)
  const notifier = new Notifier(fake, () => now)
  expect(notifier.arrived()).toBe(true)
  now += 100
  expect(notifier.arrived()).toBe(false)
  now += NOTIFY_INTERVAL_MS - 101
  expect(notifier.arrived()).toBe(false)
  now += 1
  expect(notifier.arrived()).toBe(true)
  expect(calls).toEqual([`notify hushhash: New message`, `notify hushhash: New message`])
})

test('a terminal without notifications rings the bell instead', () => {
  const { fake, calls } = terminal(false)
  new Notifier(fake).arrived()
  expect(calls).toEqual([`notify hushhash: New message`, 'bell'])
})

test('the title counts what is unread', () => {
  expect(terminalTitle({ count: 0, more: false })).toBe('hushhash')
  expect(terminalTitle({ count: 3, more: false })).toBe('hushhash (3)')
  expect(terminalTitle({ count: 12, more: true })).toBe('hushhash (12+)')
  expect(totalUnread([{ count: 2, more: false }, { count: 0, more: false }, { count: 3, more: true }])).toEqual({ count: 5, more: true })
  expect(totalUnread([])).toEqual({ count: 0, more: false })
})
