import { requireAddress } from '../../shared/address'
import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

let contacts: typeof import('./contacts')
const bob = requireAddress(`0x${'b'.repeat(40)}`)
const carol = requireAddress(`0x${'c'.repeat(40)}`)
const alice = requireAddress(`0x${'a'.repeat(40)}`)
const dave = requireAddress(`0x${'d'.repeat(40)}`)

beforeAll(async () => {
  GlobalRegistrator.register({ url: 'http://localhost' })
  contacts = await import('./contacts')
})
afterAll(() => GlobalRegistrator.unregister())
beforeEach(() => localStorage.clear())

function remember(owner: typeof bob, partner: typeof bob) {
  contacts.mergeContacts(owner, [{ address: partner, last_message_at: 1000 }])
  contacts.saveLabels(owner, { [partner]: 'Partner' })
  contacts.markConversationSeen(owner, partner, 1000)
}

test("one identity's conversations, labels and read markers are not another's", () => {
  remember(bob, alice)
  contacts.markConversationRemoved(bob, dave)

  expect(Object.keys(contacts.loadContacts(bob))).toEqual([alice])
  expect(contacts.loadContacts(carol)).toEqual({})
  expect(contacts.loadLabels(carol)).toEqual({})
  expect(contacts.lastSeen(bob, alice)).toBe(1000)
  expect(contacts.lastSeen(carol, alice)).toBeNull()
  expect(contacts.isRemoved(bob, dave, 0)).toBe(true)
  expect(contacts.isRemoved(carol, dave, 0)).toBe(false)
})

test('forgetting an identity deletes everything stored for it and nothing else', () => {
  remember(bob, alice)
  contacts.markConversationRemoved(bob, dave)
  remember(carol, alice)
  localStorage.setItem('hushhash_theme_v1', 'dark')

  contacts.forgetContactData(bob)

  expect(Object.keys(localStorage).filter(key => key.includes(bob))).toEqual([])
  expect(Object.keys(contacts.loadContacts(carol))).toEqual([alice])
  expect(contacts.lastSeen(carol, alice)).toBe(1000)
  expect(localStorage.getItem('hushhash_theme_v1')).toBe('dark')
})

function saveLegacy() {
  localStorage.setItem('hushhash_known_contacts_v1', JSON.stringify({ [alice]: { address: alice, last_message_at: 5 } }))
  localStorage.setItem('hushhash_deleted_contacts_v1', JSON.stringify({ [dave]: 7 }))
  localStorage.setItem('conversation_labels', JSON.stringify({ [alice]: 'Alice' }))
  localStorage.setItem(`last_seen_${alice}`, '5')
}
const legacyKeys = () => Object.keys(localStorage).filter(key => !key.startsWith('hushhash_0x'))

test('data saved before it was kept per identity moves to the identity this browser holds', () => {
  saveLegacy()
  contacts.adoptLegacyContactData(bob)

  expect(legacyKeys()).toEqual([])
  expect(contacts.loadContacts(bob)).toEqual({ [alice]: { address: alice, last_message_at: 5 } })
  expect(contacts.loadLabels(bob)).toEqual({ [alice]: 'Alice' })
  expect(contacts.isRemoved(bob, dave, 7)).toBe(true)
  expect(contacts.lastSeen(bob, alice)).toBe(5)
})

test('old shared data is deleted when no identity is left to own it', () => {
  saveLegacy()
  contacts.adoptLegacyContactData(null)

  expect(Object.keys(localStorage)).toEqual([])
})
