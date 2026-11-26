import { expect, test } from 'bun:test'
import { generateKeypair } from '../../src/shared/keypair'
import { UnreadCounts, unreadBadge, type MessageStamp } from './unread'

const self = generateKeypair().address
const bob = generateKeypair().address

const from = (sender: typeof bob, created_at: number): MessageStamp => ({ id: `m${created_at}`, sender, created_at })

test('badges', () => {
  expect(unreadBadge({ count: 0, more: true })).toBeNull()
  expect(unreadBadge({ count: 3, more: false })).toBe('3')
  expect(unreadBadge({ count: 3, more: true })).toBe('3+')
  expect(unreadBadge({ count: 10, more: false })).toBe('9+')
})

test('counts their messages after the last seen, not yours', () => {
  const unread = new UnreadCounts()
  expect(unread.needsFetch(bob, 300, 100)).toBe(true)
  unread.fetched(bob, [from(bob, 100), from(bob, 200), from(self, 250), from(bob, 300)], false, 300)
  expect(unread.count(bob, 100)).toEqual({ count: 2, more: false })
  expect(unread.count(bob, 300)).toEqual({ count: 0, more: false })
  expect(unread.needsFetch(bob, 300, 100)).toBe(false)
  // Nothing newer than the last seen needs no fetch at all.
  expect(unread.needsFetch(generateKeypair().address, 100, 100)).toBe(false)
})

test('a full page counts as "at least" while older ones may be unread', () => {
  const unread = new UnreadCounts()
  unread.fetched(bob, [from(bob, 500), from(self, 600)], true, 600)
  expect(unread.count(bob, 100)).toEqual({ count: 1, more: true })
  expect(unread.count(bob, 500)).toEqual({ count: 0, more: false })
})

test('live arrivals add to the count; a later page replaces it', () => {
  const unread = new UnreadCounts()
  unread.arrived(bob, 'live', 700)
  expect(unread.count(bob, 0)).toEqual({ count: 1, more: false })
  // Not fetched yet, so it still needs one.
  expect(unread.needsFetch(bob, 700, 0)).toBe(true)
  unread.fetched(bob, [from(bob, 650), { id: 'live', sender: bob, created_at: 700 }], false, 700)
  expect(unread.count(bob, 0).count).toBe(2)
  unread.arrived(bob, 'later', 800)
  expect(unread.count(bob, 0).count).toBe(3)
  expect(unread.needsFetch(bob, 800, 0)).toBe(false)
})

test('a message that arrives while a page is fetched asks for another page', () => {
  const unread = new UnreadCounts()
  // Asked for at activity 650; 'live' arrives before the answer, which lacks it.
  unread.fetched(bob, [from(bob, 600), from(bob, 650)], false, 650)
  unread.arrived(bob, 'live', 700)
  unread.fetched(bob, [from(bob, 600), from(bob, 650)], false, 650)
  expect(unread.count(bob, 0).count).toBe(2)
  expect(unread.needsFetch(bob, 700, 0)).toBe(true)
})

test('a clear or removal forgets everything before it', () => {
  const unread = new UnreadCounts()
  unread.fetched(bob, [from(bob, 100)], false, 100)
  unread.forget(bob, 100)
  expect(unread.count(bob, 0).count).toBe(0)
  expect(unread.needsFetch(bob, 100, 0)).toBe(false)
  expect(unread.needsFetch(bob, 101, 0)).toBe(true)
})

test('an expiry that lowers the last activity counts again', () => {
  const unread = new UnreadCounts()
  unread.fetched(bob, [from(bob, 100), from(bob, 200)], false, 200)
  expect(unread.needsFetch(bob, 200, 0)).toBe(false)
  expect(unread.needsFetch(bob, 100, 0)).toBe(true)
  unread.fetched(bob, [from(bob, 100)], false, 100)
  expect(unread.count(bob, 0).count).toBe(1)
})
