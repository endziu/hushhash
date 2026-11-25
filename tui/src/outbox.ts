import type { Address } from '../../src/shared/address'
import type { DecryptedMessage } from '../../src/shared/protocol-client'
import type { DeliveredMessage } from '../../src/shared/message-envelope'
import type { ShownMessage } from './message-view'

interface Entry {
  key: string
  plaintext: string
  created_at: number
  /** The server's copy once accepted; it is shown until the conversation has it too. */
  delivered: DeliveredMessage | null
  failed: boolean
  /** A failed message's text went back to the composer. */
  restored: boolean
}

/**
 * The messages you sent in the open conversation that it does not show yet:
 * those still sending, those that failed, and accepted ones whose copy has
 * not arrived over the live connection. An accepted message keeps its id as
 * its key, so its row carries straight on when the conversation's copy
 * arrives.
 */
export class Outbox {
  private entries: Entry[] = []
  private next = 0

  constructor(private readonly self: Address) {}

  /** Adds a message being sent at `now`; returns its key. */
  add(plaintext: string, now: number): string {
    const key = `outgoing:${this.next++}`
    this.entries.push({ key, plaintext, created_at: now, delivered: null, failed: false, restored: false })
    return key
  }

  delivered(key: string, message: DeliveredMessage): void {
    const entry = this.entries.find(candidate => candidate.key === key)
    if (entry) { entry.delivered = message; entry.key = message.id }
  }

  /** The message was not sent; `restored` if its text went back to the composer. */
  failed(key: string, restored: boolean): void {
    const entry = this.entries.find(candidate => candidate.key === key)
    if (entry) { entry.failed = true; entry.restored = restored }
  }

  /** Forgets failed messages, as sending another does. */
  clearFailed(): void {
    this.entries = this.entries.filter(entry => !entry.failed)
  }

  /** Forgets everything, as switching conversation or clearing it does. */
  clear(): void {
    this.entries = []
  }

  /**
   * `messages` with these after them, oldest first. Forgets accepted ones
   * the conversation now has, or that have expired.
   */
  merge(messages: readonly DecryptedMessage[], now: number): ShownMessage[] {
    const known = new Set(messages.map(message => message.id))
    this.entries = this.entries.filter(({ delivered }) => !delivered || (!known.has(delivered.id) && delivered.expires_at > now))
    return [
      ...messages.map(delivered),
      ...this.entries.map((entry): ShownMessage => entry.delivered ? delivered({ ...entry.delivered, plaintext: entry.plaintext }) : {
        key: entry.key, sender: this.self, plaintext: entry.plaintext, created_at: entry.created_at,
        opened_at: null, expires_at: null, outgoing: entry.failed ? 'failed' : 'sending', restored: entry.restored,
      }),
    ]
  }
}

function delivered(message: DecryptedMessage): ShownMessage {
  const { id, sender, plaintext, created_at, opened_at, expires_at } = message
  return { key: id, sender, plaintext, created_at, opened_at, expires_at, outgoing: null }
}
