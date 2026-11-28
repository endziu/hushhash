import { isCanonicalAddress, type Address } from '../../shared/address'

// What this browser remembers about an identity's conversations: who they were
// with, their labels, which were removed and how far each was read. Every key
// belongs to one identity (the owner), so switching to another key never
// shows the previous one's partners, and burning an identity can wipe it all.
const ownerPrefix = (owner: Address) => `hushhash_${owner}_`
const contactsKey = (owner: Address) => `${ownerPrefix(owner)}contacts`
const removedKey = (owner: Address) => `${ownerPrefix(owner)}removed`
const labelsKey = (owner: Address) => `${ownerPrefix(owner)}labels`
const lastSeenKey = (owner: Address, partner: Address) => `${ownerPrefix(owner)}last_seen_${partner}`

// Before per-identity keys, these were shared by every identity in the browser.
const LEGACY_CONTACTS_KEY = 'hushhash_known_contacts_v1'
const LEGACY_REMOVED_KEY = 'hushhash_deleted_contacts_v1'
const LEGACY_LABELS_KEY = 'conversation_labels'
const LEGACY_LAST_SEEN_PREFIX = 'last_seen_'

export interface KnownContact {
  address: Address
  last_message_at: number
}

// These records are always written keyed by Address; anything else is dropped.
function loadAddressRecord<T>(key: string, valid: (value: unknown) => value is T): Record<Address, T> {
  try {
    const record: Record<Address, T> = {}
    for (const [address, value] of Object.entries(JSON.parse(localStorage.getItem(key) ?? '{}'))) {
      if (isCanonicalAddress(address) && valid(value)) record[address] = value
    }
    return record
  } catch {
    return {}
  }
}

function storedKeys(): string[] {
  return Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter(key => key !== null)
}

/**
 * Moves conversation data saved before it was kept per identity to `owner`,
 * the identity this browser already held. With no such identity, the data
 * belonged to one that is gone, so it is deleted.
 */
export function adoptLegacyContactData(owner: Address | null): void {
  const moves = new Map<string, string | null>([
    [LEGACY_CONTACTS_KEY, owner ? contactsKey(owner) : null],
    [LEGACY_REMOVED_KEY, owner ? removedKey(owner) : null],
    [LEGACY_LABELS_KEY, owner ? labelsKey(owner) : null],
  ])
  for (const key of storedKeys()) {
    if (!key.startsWith(LEGACY_LAST_SEEN_PREFIX)) continue
    const partner = key.slice(LEGACY_LAST_SEEN_PREFIX.length)
    moves.set(key, owner && isCanonicalAddress(partner) ? lastSeenKey(owner, partner) : null)
  }
  for (const [from, to] of moves) {
    const value = localStorage.getItem(from)
    if (value === null) continue
    if (to && localStorage.getItem(to) === null) localStorage.setItem(to, value)
    localStorage.removeItem(from)
  }
}

/** Deletes everything this browser remembers about `owner`'s conversations. */
export function forgetContactData(owner: Address): void {
  const prefix = ownerPrefix(owner)
  for (const key of storedKeys()) if (key.startsWith(prefix)) localStorage.removeItem(key)
}

const lastSeenListeners = new Set<() => void>()

/** When `owner` last read the conversation with `partner`, as the createdAt it was read through. */
export function lastSeen(owner: Address, partner: Address): number | null {
  const value = localStorage.getItem(lastSeenKey(owner, partner))
  return value === null ? null : Number(value)
}

/**
 * Records that a conversation has been read through the message accepted at
 * `createdAt`. Only moves forward; listeners hear about each advance.
 */
export function markConversationSeen(owner: Address, partner: Address, createdAt: number): void {
  if ((lastSeen(owner, partner) ?? 0) >= createdAt) return
  localStorage.setItem(lastSeenKey(owner, partner), String(createdAt))
  for (const listener of lastSeenListeners) listener()
}

export function subscribeLastSeen(listener: () => void): () => void {
  lastSeenListeners.add(listener)
  return () => { lastSeenListeners.delete(listener) }
}

function loadRemoved(owner: Address): Record<Address, number> {
  return loadAddressRecord(removedKey(owner), (value): value is number => typeof value === 'number')
}

// Removes a conversation from the list, forgetting what is stored for it. It
// stays removed until new activity (a later last_message_at) supersedes that.
export function markConversationRemoved(owner: Address, partner: Address) {
  const contacts = loadContacts(owner)
  delete contacts[partner]
  saveContacts(owner, contacts)

  const removed = loadRemoved(owner)
  removed[partner] = Date.now()
  localStorage.setItem(removedKey(owner), JSON.stringify(removed))

  localStorage.removeItem(lastSeenKey(owner, partner))
}

export function isRemoved(owner: Address, partner: Address, lastMessageAt: number): boolean {
  const removedAt = loadRemoved(owner)[partner]
  return removedAt !== undefined && lastMessageAt <= removedAt
}

function isKnownContact(value: unknown): value is KnownContact {
  const contact = value as Partial<KnownContact> | null
  return isCanonicalAddress(contact?.address) && typeof contact.last_message_at === 'number'
}

export function loadContacts(owner: Address): Record<Address, KnownContact> {
  return loadAddressRecord(contactsKey(owner), isKnownContact)
}

function saveContacts(owner: Address, contacts: Record<Address, KnownContact>) {
  localStorage.setItem(contactsKey(owner), JSON.stringify(contacts))
}

export function mergeContacts(owner: Address, seen: KnownContact[]): Record<Address, KnownContact> {
  const current = loadContacts(owner)
  for (const { address, last_message_at } of seen) {
    const existing = current[address]
    if (!existing || last_message_at > existing.last_message_at) {
      current[address] = { address, last_message_at }
    }
  }
  saveContacts(owner, current)
  return current
}

export function loadLabels(owner: Address): Record<Address, string> {
  return loadAddressRecord(labelsKey(owner), (value): value is string => typeof value === 'string')
}

export function saveLabels(owner: Address, labels: Record<Address, string>): void {
  localStorage.setItem(labelsKey(owner), JSON.stringify(labels))
}
