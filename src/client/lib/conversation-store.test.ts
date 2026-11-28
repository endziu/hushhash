import { requireAddress } from '../../shared/address'
import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

let store: typeof import('./conversation-store')
const bob = requireAddress(`0x${'b'.repeat(40)}`)
const carol = requireAddress(`0x${'c'.repeat(40)}`)
const alice = requireAddress(`0x${'a'.repeat(40)}`)
const dave = requireAddress(`0x${'d'.repeat(40)}`)

beforeAll(async () => {
  GlobalRegistrator.register({ url: 'http://localhost' })
  store = await import('./conversation-store')
})
afterAll(() => GlobalRegistrator.unregister())
beforeEach(() => localStorage.clear())

function remember(self: typeof bob, partner: typeof bob) {
  store.rememberConversations(self, [{ address: partner, last_message_at: 1000 }])
  store.saveLabels(self, { [partner]: 'Partner' })
  store.markConversationSeen(self, partner, 1000)
}

test("one identity's conversations, labels and read markers are not another's", () => {
  remember(bob, alice)
  store.markConversationRemoved(bob, dave)

  expect(Object.keys(store.loadRememberedConversations(bob))).toEqual([alice])
  expect(store.loadRememberedConversations(carol)).toEqual({})
  expect(store.loadLabels(carol)).toEqual({})
  expect(store.lastSeen(bob, alice)).toBe(1000)
  expect(store.lastSeen(carol, alice)).toBeNull()
  expect(store.isRemoved(bob, dave, 0)).toBe(true)
  expect(store.isRemoved(carol, dave, 0)).toBe(false)
})

test('removing a conversation forgets its read marker and keeps the others', () => {
  remember(bob, alice)
  remember(bob, dave)
  store.markConversationRemoved(bob, dave)

  expect(store.lastSeen(bob, dave)).toBeNull()
  expect(store.lastSeen(bob, alice)).toBe(1000)
})

test('forgetting an identity deletes everything stored for it and nothing else', () => {
  remember(bob, alice)
  store.markConversationRemoved(bob, dave)
  remember(carol, alice)
  localStorage.setItem('hushhash_theme_v1', 'dark')

  store.forgetConversationData(bob)

  expect(Object.keys(localStorage).filter(key => key.includes(bob))).toEqual([])
  expect(Object.keys(store.loadRememberedConversations(carol))).toEqual([alice])
  expect(store.lastSeen(carol, alice)).toBe(1000)
  expect(localStorage.getItem('hushhash_theme_v1')).toBe('dark')
})

function saveLegacy() {
  localStorage.setItem('hushhash_known_contacts_v1', JSON.stringify({ [alice]: { address: alice, last_message_at: 5 } }))
  localStorage.setItem('hushhash_deleted_contacts_v1', JSON.stringify({ [dave]: 7 }))
  localStorage.setItem('conversation_labels', JSON.stringify({ [alice]: 'Alice' }))
  localStorage.setItem(`last_seen_${alice}`, '5')
  localStorage.setItem(`last_seen_${dave}`, '6')
}
const legacyKeys = () => Object.keys(localStorage).filter(key => !key.includes(bob))

test('data saved before it was kept per identity moves to the identity this browser holds', () => {
  saveLegacy()
  store.adoptLegacyConversationData(bob)

  expect(legacyKeys()).toEqual([])
  expect(store.loadRememberedConversations(bob)).toEqual({ [alice]: { address: alice, last_message_at: 5 } })
  expect(store.loadLabels(bob)).toEqual({ [alice]: 'Alice' })
  expect(store.isRemoved(bob, dave, 7)).toBe(true)
  expect(store.lastSeen(bob, alice)).toBe(5)
  expect(store.lastSeen(bob, dave)).toBe(6)
})

test('moving old data never overwrites what the identity already has', () => {
  store.saveLabels(bob, { [alice]: 'Newer' })
  store.markConversationSeen(bob, alice, 9)
  saveLegacy()
  store.adoptLegacyConversationData(bob)

  expect(legacyKeys()).toEqual([])
  expect(store.loadLabels(bob)).toEqual({ [alice]: 'Newer' })
  expect(store.lastSeen(bob, alice)).toBe(9)
  expect(store.lastSeen(bob, dave)).toBeNull()
})

test('old shared data is deleted when no identity is left to own it', () => {
  saveLegacy()
  store.adoptLegacyConversationData(null)

  expect(Object.keys(localStorage)).toEqual([])
})
