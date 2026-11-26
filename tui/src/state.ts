import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isCanonicalAddress, type Address } from '../../src/shared/address'

/** The longest a conversation name may be, in characters, as in the browser. */
export const NAME_MAX_LENGTH = 64

/** A name as stored: trimmed, at most NAME_MAX_LENGTH characters; empty means none. */
export function cleanName(name: string): string {
  return [...name.trim()].slice(0, NAME_MAX_LENGTH).join('').trim()
}

/** What this device remembers about one conversation. Absent fields are unknown. */
export interface ConversationState {
  name?: string
  /** The newest acceptance time (server time) through which you have seen it. */
  lastSeen?: number
  /** Its last_message_at when you removed it; newer activity brings it back. */
  removedAt?: number
}

interface IdentityState {
  conversations: Record<Address, ConversationState>
  /** False when desktop notifications are off; absent means on. */
  notify?: false
}

interface StateDocument {
  version: 1
  identities: Record<Address, IdentityState>
}

/** The state file beside the identity file. */
export function statePath(identityPath: string): string {
  return join(dirname(identityPath), 'tui-state.json')
}

const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

function parseConversation(value: unknown): ConversationState | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const state: ConversationState = {}
  if (typeof raw.name === 'string' && cleanName(raw.name)) state.name = cleanName(raw.name)
  if (isTime(raw.lastSeen)) state.lastSeen = raw.lastSeen
  if (isTime(raw.removedAt)) state.removedAt = raw.removedAt
  return Object.keys(state).length ? state : null
}

/** Whatever of `value` is valid; anything else is dropped. */
function parseDocument(value: unknown): StateDocument {
  const document: StateDocument = { version: 1, identities: {} }
  const identities = (value as { identities?: unknown } | null)?.identities
  if (typeof identities !== 'object' || identities === null) return document
  for (const [self, identity] of Object.entries(identities)) {
    const conversations = (identity as { conversations?: unknown } | null)?.conversations
    if (!isCanonicalAddress(self) || typeof conversations !== 'object' || conversations === null) continue
    const parsed: Record<Address, ConversationState> = {}
    for (const [address, conversation] of Object.entries(conversations)) {
      const state = parseConversation(conversation)
      if (isCanonicalAddress(address) && state) parsed[address] = state
    }
    document.identities[self] = { conversations: parsed }
    if ((identity as { notify?: unknown }).notify === false) document.identities[self].notify = false
  }
  return document
}

/**
 * The TUI's local memory of conversations: names, how far you have read, and
 * which you removed from the list; and whether to notify the desktop. One file holds every identity's state,
 * keyed by its address so they never mix. Names are private, so the file is
 * written atomically and readable only by you, and never leaves the machine.
 * A missing or corrupt file starts empty. Without a path nothing is saved.
 */
export class TuiState {
  private readonly document: StateDocument
  private readonly mine: IdentityState

  /** Hears about a failed save; the state in memory stays as it is. */
  onError: (error: unknown) => void = () => {}

  private constructor(private readonly path: string | null, self: Address, document: StateDocument) {
    this.document = document
    this.mine = document.identities[self] ??= { conversations: {} }
  }

  /** Reads the state at `path` for `self`. */
  static load(path: string, self: Address): TuiState {
    let document: StateDocument
    try {
      document = parseDocument(JSON.parse(readFileSync(path, 'utf8')))
    } catch {
      document = parseDocument(null)
    }
    return new TuiState(path, self, document)
  }

  /** State that lives only as long as the app. */
  static memory(self: Address): TuiState {
    return new TuiState(null, self, parseDocument(null))
  }

  private conversation(address: Address): ConversationState | undefined {
    return this.mine.conversations[address]
  }

  name(address: Address): string | null {
    return this.conversation(address)?.name ?? null
  }

  /** Every named conversation's name. */
  names(): Record<Address, string> {
    const names: Record<Address, string> = {}
    for (const [address, state] of Object.entries(this.mine.conversations) as [Address, ConversationState][]) {
      if (state.name) names[address] = state.name
    }
    return names
  }

  /** Names a conversation; an empty name clears it. Returns the name kept. */
  setName(address: Address, name: string): string {
    const cleaned = cleanName(name)
    this.update(address, state => {
      if (cleaned) state.name = cleaned
      else delete state.name
    })
    return cleaned
  }

  lastSeen(address: Address): number | null {
    return this.conversation(address)?.lastSeen ?? null
  }

  /** Records that the conversation has been seen through `acceptedAt`; it only moves forward. */
  markSeen(address: Address, acceptedAt: number): void {
    if ((this.lastSeen(address) ?? -1) >= acceptedAt) return
    this.update(address, state => { state.lastSeen = acceptedAt })
  }

  /**
   * Messages accepted after this are unread: after the last you saw, and
   * after the conversation was removed, since what came before was dismissed.
   */
  unreadAfter(address: Address): number {
    const state = this.conversation(address)
    return Math.max(state?.lastSeen ?? 0, state?.removedAt ?? 0)
  }

  /**
   * Takes a conversation off the list until activity after `lastMessageAt`,
   * forgetting its name and last-seen. Null, for one without messages,
   * forgets it entirely.
   */
  remove(address: Address, lastMessageAt: number | null): void {
    if (lastMessageAt === null) delete this.mine.conversations[address]
    else this.mine.conversations[address] = { removedAt: lastMessageAt }
    this.save()
  }

  /** Whether a conversation whose last message was accepted at `lastMessageAt` stays off the list. */
  isRemoved(address: Address, lastMessageAt: number): boolean {
    const removedAt = this.conversation(address)?.removedAt
    return removedAt !== undefined && lastMessageAt <= removedAt
  }

  /** Whether a message that arrives while you are away notifies the desktop. On unless turned off. */
  notifications(): boolean {
    return this.mine.notify !== false
  }

  setNotifications(on: boolean): void {
    if (on) delete this.mine.notify
    else this.mine.notify = false
    this.save()
  }

  private update(address: Address, change: (state: ConversationState) => void): void {
    const state = { ...this.conversation(address) }
    change(state)
    if (Object.keys(state).length) this.mine.conversations[address] = state
    else delete this.mine.conversations[address]
    this.save()
  }

  /** Writes the whole file: a private temporary file, synced, then renamed over the old one. */
  private save(): void {
    const path = this.path
    if (!path) return
    const temporary = `${path}.${process.pid}.tmp`
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      // A leftover from a crash goes first: exclusive creation sets the mode and follows no link.
      try { unlinkSync(temporary) } catch { /* none */ }
      const fd = openSync(temporary, 'wx', 0o600)
      try {
        writeSync(fd, JSON.stringify(this.document) + '\n')
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      renameSync(temporary, path)
    } catch (error) {
      try { unlinkSync(temporary) } catch { /* never created */ }
      this.onError(error)
    }
  }
}
