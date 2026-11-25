import { expect, test } from 'bun:test'
import { generateKeypair } from '../../src/shared/keypair'
import { UNOPENED_RETENTION_MS } from '../../src/shared/message-envelope'
import {
  GROUP_GAP_MS, NewMessages, expiryTone, layoutRows, messageMeta, messageState, newestAccepted, type ShownMessage,
} from './message-view'

const self = generateKeypair().address
const partner = generateKeypair().address
const NOW = new Date(2026, 10, 25, 15, 0).getTime()
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

function message(key: string, sender: typeof self, created_at: number, extra: Partial<ShownMessage> = {}): ShownMessage {
  return { key, sender, plaintext: key, created_at, opened_at: created_at, expires_at: created_at + 30 * MINUTE, outgoing: null, ...extra }
}

const summary = (messages: ShownMessage[], firstNew: string | null = null) =>
  layoutRows(messages, self, NOW, firstNew).map(({ key, mine, day, header, firstNew: isNew }) => ({ key, mine, day, header, isNew }))

test('your messages and theirs are told apart, and the first of a run has the header', () => {
  expect(summary([
    message('a', partner, NOW - 10 * MINUTE),
    message('b', partner, NOW - 9 * MINUTE),
    message('c', self, NOW - 8 * MINUTE),
    message('d', self, NOW - 7 * MINUTE),
  ])).toEqual([
    { key: 'a', mine: false, day: 'Today', header: true, isNew: false },
    { key: 'b', mine: false, day: null, header: false, isNew: false },
    { key: 'c', mine: true, day: null, header: true, isNew: false },
    { key: 'd', mine: true, day: null, header: false, isNew: false },
  ])
})

test('a gap longer than the grouping window starts a new group', () => {
  const rows = summary([
    message('a', partner, NOW - 30 * MINUTE),
    message('b', partner, NOW - 30 * MINUTE + GROUP_GAP_MS),
    message('c', partner, NOW - 30 * MINUTE + 2 * GROUP_GAP_MS + 1),
  ])
  expect(rows.map(row => row.header)).toEqual([true, false, true])
})

test('a new day gets a label and starts a new group', () => {
  const rows = summary([
    message('a', partner, NOW - 8 * DAY),
    message('b', partner, NOW - DAY),
    message('c', partner, NOW - DAY + MINUTE),
    message('d', partner, NOW - MINUTE),
  ])
  expect(rows.map(row => row.day)).toEqual([
    new Date(NOW - 8 * DAY).toLocaleDateString([], { month: 'short', day: 'numeric' }), 'Yesterday', null, 'Today',
  ])
  expect(rows.map(row => row.header)).toEqual([true, true, false, true])
})

test('the new-messages divider starts a group of its own', () => {
  const rows = summary([
    message('a', partner, NOW - 3 * MINUTE),
    message('b', partner, NOW - 2 * MINUTE),
  ], 'b')
  expect(rows.map(({ header, isNew }) => ({ header, isNew }))).toEqual([{ header: true, isNew: false }, { header: true, isNew: true }])
})

test('expiry turns to warning in the last fifth and critical in the last 10 seconds', () => {
  // Opened with a 100s lifetime.
  const opened = { opened_at: NOW, expires_at: NOW + 100_000 }
  expect(expiryTone(opened, NOW)).toBe('normal')
  expect(expiryTone(opened, NOW + 79_999)).toBe('normal')
  expect(expiryTone(opened, NOW + 80_000)).toBe('warning')
  expect(expiryTone(opened, NOW + 89_999)).toBe('warning')
  expect(expiryTone(opened, NOW + 90_000)).toBe('critical')
  // Unopened, the 24h retention limit is the lifetime.
  const unopened = { opened_at: null, expires_at: NOW + UNOPENED_RETENTION_MS }
  expect(expiryTone(unopened, NOW + UNOPENED_RETENTION_MS * 0.79)).toBe('normal')
  expect(expiryTone(unopened, NOW + UNOPENED_RETENTION_MS * 0.81)).toBe('warning')
  expect(expiryTone({ opened_at: null, expires_at: null }, NOW)).toBe('normal')
})

test('your messages show their state; an unopened one shows the retention limit by name', () => {
  const sending = message('s', self, NOW, { opened_at: null, expires_at: null, outgoing: 'sending' })
  const failed = { ...sending, outgoing: 'failed' as const }
  const unopened = message('u', self, NOW, { opened_at: null, expires_at: NOW + UNOPENED_RETENTION_MS })
  const opened = message('o', self, NOW - MINUTE, { opened_at: NOW - MINUTE, expires_at: NOW + 4 * MINUTE })
  expect([sending, failed, unopened, opened].map(messageState)).toEqual(['sending', 'failed', 'unopened', 'opened'])
  expect(messageMeta(sending, true, NOW)).toMatchObject({ label: 'sending', icon: '◌' })
  expect(messageMeta(failed, true, NOW)).toMatchObject({ label: 'not sent · retype to resend', icon: '✗' })
  expect(messageMeta({ ...failed, restored: true }, true, NOW)).toMatchObject({ label: 'not sent · Enter resends' })
  expect(messageMeta(unopened, true, NOW)).toMatchObject({ label: 'unopened 24h', icon: '○', tone: 'normal' })
  expect(messageMeta(opened, true, NOW)).toMatchObject({ label: '4m', icon: '✓' })
  expect(messageMeta(opened, true, NOW + 4 * MINUTE - 12_000)).toMatchObject({ label: '12s', tone: 'warning' })
  // Theirs show the time left without an icon.
  expect(messageMeta({ ...opened, sender: partner }, false, NOW)).toMatchObject({ label: '4m', icon: null })
})

test('new messages are those from your partner accepted after the newest you saw', () => {
  const marker = new NewMessages()
  const messages = [
    message('old', partner, NOW - 10 * MINUTE),
    message('mine', self, NOW - 4 * MINUTE),
    message('new1', partner, NOW - 3 * MINUTE),
    message('new2', partner, NOW - 2 * MINUTE),
  ]
  // Nothing is new until there is something to count from.
  expect(marker.first(messages, partner)).toBeNull()
  marker.reset(NOW - 5 * MINUTE)
  expect(marker.first(messages, partner)).toBe('new1')
  marker.reset(null)
  expect(marker.first(messages, partner)).toBeNull()
})

test('what arrives while you look is not new, however its time compares', () => {
  const marker = new NewMessages()
  marker.reset(NOW - 5 * MINUTE)
  marker.arrivedWhileLooking('live')
  expect(marker.first([message('live', partner, NOW)], partner)).toBeNull()
  expect(marker.first([message('live', partner, NOW), message('later', partner, NOW + MINUTE)], partner)).toBe('later')
})

test('looking away counts from the newest message on screen, and keeps an earlier mark', () => {
  const marker = new NewMessages()
  const seen = message('seen', partner, NOW)
  marker.away(newestAccepted([seen]))
  const during = message('during', partner, NOW + MINUTE)
  expect(marker.first([seen, during], partner)).toBe('during')
  // Away again while marked: still counts from the first time.
  marker.away(newestAccepted([seen, during]))
  expect(marker.first([seen, during, message('again', partner, NOW + 2 * MINUTE)], partner)).toBe('during')

  // Away with nothing on screen: whatever arrives is new.
  const empty = new NewMessages()
  empty.away(newestAccepted([]))
  expect(empty.first([message('first', partner, NOW)], partner)).toBe('first')
})
