import type { Address } from '../../src/shared/address'

/** A message's sender and acceptance time, which the server sends unencrypted. */
export interface MessageStamp {
  id: string
  sender: Address
  created_at: number
}

/** How many messages from your partner you have not seen. */
export interface UnreadCount {
  count: number
  /** Older ones may be missing from `count`, so there are at least this many. */
  more: boolean
}

/** The list's badge for `unread`: 3, 4+ or 9+; null when there is nothing unread. */
export function unreadBadge({ count, more }: UnreadCount): string | null {
  if (count === 0) return null
  if (count > 9) return '9+'
  return more ? `${count}+` : String(count)
}

/** What is known of one conversation's messages from your partner. */
interface Known {
  /** Acceptance times of their messages, by id. */
  times: Map<string, number>
  /** The oldest acceptance time known complete from; null if nothing older is missing. */
  from: number | null
  /** The newest activity the last fetch covered; null before one. */
  fetchedThrough: number | null
}

/**
 * Counts unread messages per conversation from what the server says about
 * them (a recent page of each, fetched when its activity changed since it
 * was counted) and from live events in between.
 */
export class UnreadCounts {
  private readonly known = new Map<Address, Known>()

  /** Whether `partner`'s conversation, last active at `lastMessageAt`, needs a page fetched to count what came after `after`. */
  needsFetch(partner: Address, lastMessageAt: number, after: number): boolean {
    if (lastMessageAt <= after) return false
    // Changed either way: newer activity, or an expiry that took the newest message away.
    return this.known.get(partner)?.fetchedThrough !== lastMessageAt
  }

  /**
   * Records a fetched page of the newest messages, `full` if the server had
   * more, as of activity at `lastMessageAt` when it was asked for. The page
   * replaces what was known, so expired and cleared messages stop counting.
   * Anything that arrived meanwhile is newer than `lastMessageAt`, so
   * needsFetch asks for another page.
   */
  fetched(partner: Address, page: readonly MessageStamp[], full: boolean, lastMessageAt: number): void {
    const known = this.entry(partner)
    known.times = new Map(page.filter(message => message.sender === partner).map(message => [message.id, message.created_at]))
    known.from = full && page.length ? Math.min(...page.map(message => message.created_at)) : null
    known.fetchedThrough = lastMessageAt
  }

  /** A message from `partner` arrived live. */
  arrived(partner: Address, id: string, createdAt: number): void {
    const known = this.entry(partner)
    known.times.set(id, createdAt)
    if (known.fetchedThrough !== null) known.fetchedThrough = Math.max(known.fetchedThrough, createdAt)
  }

  /** The conversation was cleared at `clearedAt`, or removed: nothing in it is unread any more. */
  forget(partner: Address, through: number | null): void {
    this.known.set(partner, { times: new Map(), from: null, fetchedThrough: through })
  }

  /** Unread messages from `partner` accepted after `after`. */
  count(partner: Address, after: number): UnreadCount {
    const known = this.known.get(partner)
    if (!known) return { count: 0, more: false }
    let count = 0
    for (const time of known.times.values()) if (time > after) count++
    return { count, more: count > 0 && known.from !== null && after < known.from }
  }

  private entry(partner: Address): Known {
    let known = this.known.get(partner)
    if (!known) this.known.set(partner, known = { times: new Map(), from: null, fetchedThrough: null })
    return known
  }
}
