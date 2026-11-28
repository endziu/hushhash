import { isCanonicalAddress, type Address } from '../../shared/address'

// What this browser remembers about an identity's conversations: who the
// conversation partners were, their labels, which conversations were removed and
// how far each was read. Each record belongs to one identity (`self`), so another
// identity never sees them, and burning the identity deletes all four.
const partnersKey = (self: Address) => `hushhash_partners_v1_${self}`
const removedKey = (self: Address) => `hushhash_removed_v1_${self}`
const labelsKey = (self: Address) => `hushhash_labels_v1_${self}`
const lastSeenKey = (self: Address) => `hushhash_last_seen_v1_${self}`
const recordKeys = (self: Address) => [partnersKey(self), removedKey(self), labelsKey(self), lastSeenKey(self)]

// Before records were kept per identity, every identity in the browser shared these.
const LEGACY_PARTNERS_KEY = 'hushhash_known_contacts_v1'
const LEGACY_REMOVED_KEY = 'hushhash_deleted_contacts_v1'
const LEGACY_LABELS_KEY = 'conversation_labels'
const LEGACY_LAST_SEEN_PREFIX = 'last_seen_'

export interface RememberedConversation {
  address: Address
  last_message_at: number
}

const isNumber = (value: unknown): value is number => typeof value === 'number'
const isString = (value: unknown): value is string => typeof value === 'string'

function isRememberedConversation(value: unknown): value is RememberedConversation {
  const conversation = value as Partial<RememberedConversation> | null
  return isCanonicalAddress(conversation?.address) && isNumber(conversation.last_message_at)
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

function saveAddressRecord(key: string, record: Record<Address, unknown>): void {
  localStorage.setItem(key, JSON.stringify(record))
}

// Read markers used to be one key per conversation partner; now they are one record.
function takeLegacyLastSeen(): Record<Address, number> | null {
  const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
    .filter((key): key is string => key?.startsWith(LEGACY_LAST_SEEN_PREFIX) === true)
  if (keys.length === 0) return null
  const lastSeen: Record<Address, number> = {}
  for (const key of keys) {
    const partner = key.slice(LEGACY_LAST_SEEN_PREFIX.length)
    const value = Number(localStorage.getItem(key))
    if (isCanonicalAddress(partner) && Number.isFinite(value)) lastSeen[partner] = value
    localStorage.removeItem(key)
  }
  return lastSeen
}

/**
 * Moves conversation data saved before it was kept per identity to `self`, the
 * identity this browser already held. With no such identity, the data belonged
 * to one that is gone, so it is deleted. Records `self` already has are kept.
 */
export function adoptLegacyConversationData(self: Address | null): void {
  const moves: [string, (self: Address) => string][] = [
    [LEGACY_PARTNERS_KEY, partnersKey],
    [LEGACY_REMOVED_KEY, removedKey],
    [LEGACY_LABELS_KEY, labelsKey],
  ]
  for (const [from, to] of moves) {
    const value = localStorage.getItem(from)
    if (value === null) continue
    if (self && localStorage.getItem(to(self)) === null) localStorage.setItem(to(self), value)
    localStorage.removeItem(from)
  }
  const lastSeen = takeLegacyLastSeen()
  if (lastSeen && self && localStorage.getItem(lastSeenKey(self)) === null) saveAddressRecord(lastSeenKey(self), lastSeen)
}

/** Deletes everything this browser remembers about `self`'s conversations. */
export function forgetConversationData(self: Address): void {
  for (const key of recordKeys(self)) localStorage.removeItem(key)
}

const lastSeenListeners = new Set<() => void>()

function loadLastSeen(self: Address): Record<Address, number> {
  return loadAddressRecord(lastSeenKey(self), isNumber)
}

/** How far `self` has read the conversation with `partner`, as the createdAt it was read through. */
export function lastSeen(self: Address, partner: Address): number | null {
  return loadLastSeen(self)[partner] ?? null
}

/**
 * Records that a conversation has been read through the message accepted at
 * `createdAt`. Only moves forward; listeners hear about each advance.
 */
export function markConversationSeen(self: Address, partner: Address, createdAt: number): void {
  const seen = loadLastSeen(self)
  if ((seen[partner] ?? 0) >= createdAt) return
  seen[partner] = createdAt
  saveAddressRecord(lastSeenKey(self), seen)
  for (const listener of lastSeenListeners) listener()
}

export function subscribeLastSeen(listener: () => void): () => void {
  lastSeenListeners.add(listener)
  return () => { lastSeenListeners.delete(listener) }
}

function loadRemoved(self: Address): Record<Address, number> {
  return loadAddressRecord(removedKey(self), isNumber)
}

function saveRemoved(self: Address, removed: Record<Address, number>): void {
  saveAddressRecord(removedKey(self), removed)
}

// Removes a conversation from the list, forgetting what is stored for it. It
// stays removed until new activity (a later last_message_at) supersedes that.
export function markConversationRemoved(self: Address, partner: Address): void {
  const remembered = loadRememberedConversations(self)
  delete remembered[partner]
  saveRememberedConversations(self, remembered)

  const removed = loadRemoved(self)
  removed[partner] = Date.now()
  saveRemoved(self, removed)

  const seen = loadLastSeen(self)
  delete seen[partner]
  saveAddressRecord(lastSeenKey(self), seen)
}

export function isRemoved(self: Address, partner: Address, lastMessageAt: number): boolean {
  const removedAt = loadRemoved(self)[partner]
  return removedAt !== undefined && lastMessageAt <= removedAt
}

export function loadRememberedConversations(self: Address): Record<Address, RememberedConversation> {
  return loadAddressRecord(partnersKey(self), isRememberedConversation)
}

function saveRememberedConversations(self: Address, conversations: Record<Address, RememberedConversation>): void {
  saveAddressRecord(partnersKey(self), conversations)
}

/** Remembers `seen` alongside what is already stored, keeping each partner's latest activity. */
export function rememberConversations(self: Address, seen: RememberedConversation[]): Record<Address, RememberedConversation> {
  const current = loadRememberedConversations(self)
  for (const { address, last_message_at } of seen) {
    const existing = current[address]
    if (!existing || last_message_at > existing.last_message_at) {
      current[address] = { address, last_message_at }
    }
  }
  saveRememberedConversations(self, current)
  return current
}

export function loadLabels(self: Address): Record<Address, string> {
  return loadAddressRecord(labelsKey(self), isString)
}

export function saveLabels(self: Address, labels: Record<Address, string>): void {
  saveAddressRecord(labelsKey(self), labels)
}
