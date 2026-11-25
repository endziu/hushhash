import type { Address } from '../../src/shared/address'
import { UNOPENED_RETENTION_MS } from '../../src/shared/message-envelope'
import { fmtDay, fmtRemaining } from '../../src/client/lib/display'

/** What a transcript row needs to know about a message, delivered or not. */
export interface ShownMessage {
  /** The message id, or an outgoing message's key. */
  key: string
  sender: Address
  plaintext: string
  created_at: number
  /** Null while unopened. */
  opened_at: number | null
  /** Null for an outgoing message, which has no deadline yet. */
  expires_at: number | null
  /** How an outgoing message is doing; null once delivered. */
  outgoing: 'sending' | 'failed' | null
  /** A failed message's text went back to the composer, so Enter resends it. */
  restored?: boolean
}

/** Messages from one sender within this long of each other share a header. */
export const GROUP_GAP_MS = 5 * 60_000

/** How a row is laid out: what goes above its bubble. */
export interface RowLayout {
  key: string
  mine: boolean
  /** A day label (Today, Yesterday, Tue, Nov 12) to show above, or null. */
  day: string | null
  /** The first message since you last looked: a divider goes above it. */
  firstNew: boolean
  /** First of a group: shows the sender and time. */
  header: boolean
}

const dayLabel = (ts: number, now: number) => fmtDay(ts, now) ?? 'Today'

/**
 * Where the separators and headers go. A new group starts at a change of
 * sender, a gap over GROUP_GAP_MS, a new day, or the new-messages divider.
 */
export function layoutRows(messages: readonly ShownMessage[], self: Address, now: number, firstNewKey: string | null): RowLayout[] {
  let previous: ShownMessage | null = null
  return messages.map(message => {
    const day = dayLabel(message.created_at, now)
    const newDay = previous === null || dayLabel(previous.created_at, now) !== day
    const firstNew = message.key === firstNewKey
    const header = newDay || firstNew || previous!.sender !== message.sender
      || message.created_at - previous!.created_at > GROUP_GAP_MS
    previous = message
    return { key: message.key, mine: message.sender === self, day: newDay ? day : null, firstNew, header }
  })
}

/** How soon a message disappears: normal, then warning in its last 20%, then critical in its last 10s. */
export type ExpiryTone = 'normal' | 'warning' | 'critical'

export const CRITICAL_MS = 10_000
export const WARNING_FRACTION = 0.2

export function expiryTone(message: Pick<ShownMessage, 'opened_at' | 'expires_at'>, now: number): ExpiryTone {
  if (message.expires_at === null) return 'normal'
  const left = message.expires_at - now
  if (left <= CRITICAL_MS) return 'critical'
  // Unopened, the deadline is the retention limit; opened, it is the message's lifetime.
  const lifetime = message.opened_at === null ? UNOPENED_RETENTION_MS : message.expires_at - message.opened_at
  return left <= lifetime * WARNING_FRACTION ? 'warning' : 'normal'
}

/** The state of a message you sent. */
export const STATE_ICONS = {
  sending: '◌',
  unopened: '○',
  opened: '✓',
  failed: '✗',
} as const

export type MessageState = keyof typeof STATE_ICONS

export function messageState(message: Pick<ShownMessage, 'opened_at' | 'outgoing'>): MessageState {
  if (message.outgoing) return message.outgoing
  return message.opened_at === null ? 'unopened' : 'opened'
}

/** What the bubble shows beside the text: time left, and on yours, its state. */
export interface MessageMeta {
  /** Time left, or a word for an outgoing message. */
  label: string
  tone: ExpiryTone
  /** Only on your own messages. */
  icon: string | null
  state: MessageState
}

export function messageMeta(message: ShownMessage, mine: boolean, now: number): MessageMeta {
  const state = messageState(message)
  const tone = expiryTone(message, now)
  const icon = mine ? STATE_ICONS[state] : null
  if (state === 'sending') return { label: 'sending', tone, icon, state }
  if (state === 'failed') return { label: message.restored ? 'not sent · Enter resends' : 'not sent · retype to resend', tone, icon, state }
  const left = fmtRemaining(message.expires_at!, now)
  // Its own wording, so the retention limit is not mistaken for its lifetime.
  return { label: state === 'unopened' && mine ? `unopened ${left}` : left, tone, icon, state }
}

/** The newest acceptance time among `messages`, or null for none. */
export function newestAccepted(messages: readonly Pick<ShownMessage, 'created_at'>[]): number | null {
  return messages.reduce<number | null>((newest, message) => Math.max(newest ?? -Infinity, message.created_at), null)
}

/**
 * Finds the first message from your partner since you last looked at a
 * conversation. Only acceptance times, which are server time, are compared,
 * so the local clock never matters: a message is new when it was accepted
 * after the newest one you had on screen, and did not arrive live while you
 * were looking. Sending or switching away removes the mark.
 */
export class NewMessages {
  /** Messages accepted after this are new; null when nothing is. */
  private since: number | null = null
  /** Arrived while you were looking, so not new whenever accepted. */
  private readonly seen = new Set<string>()
  private marked = false

  /** Starts over: messages accepted after `since` are new; null means none are. */
  reset(since: number | null): void {
    this.since = since
    this.seen.clear()
    this.marked = false
  }

  /** A message that arrived while you were looking. */
  arrivedWhileLooking(key: string): void {
    this.seen.add(key)
  }

  /**
   * You stopped looking; `newest` is the newest acceptance time on screen.
   * An existing mark stays, so it keeps counting from the earlier time.
   */
  away(newest: number | null): void {
    if (this.marked) return
    // With nothing on screen, everything that arrives from now on is new.
    this.since = newest ?? -Infinity
  }

  /** The key of the first new message from `partner`, if any; keeps a later away() from moving it. */
  first(messages: readonly ShownMessage[], partner: Address): string | null {
    const since = this.since
    const found = since === null ? undefined : messages.find(message =>
      message.sender === partner && message.created_at > since && !this.seen.has(message.key))
    this.marked = found !== undefined
    return found?.key ?? null
  }
}
