import type { UnreadCount } from './unread'

/** Notifications are content-free, like push: no sender, no text. */
export const NOTIFICATION_TITLE = 'hushhash'
export const NOTIFICATION_MESSAGE = 'New message'

/** At most one notification this often, so a burst of messages makes one. */
export const NOTIFY_INTERVAL_MS = 5000

/** What the terminal can do to get your attention. */
export interface NotifyTerminal {
  /** A desktop notification (OSC 9, 99 or 777, as the terminal supports); false if it supports none. */
  notify(title: string, message: string): boolean
  /** Rings the bell. */
  bell(): void
}

/**
 * Tells the desktop that a message arrived while you were away: a
 * notification where the terminal has them, else the bell. A burst within
 * NOTIFY_INTERVAL_MS of the last one makes no more.
 */
export class Notifier {
  private last = -Infinity

  constructor(private readonly terminal: NotifyTerminal, private readonly now: () => number = Date.now) {}

  /** A message arrived; whether the desktop was told. */
  arrived(): boolean {
    const now = this.now()
    if (now - this.last < NOTIFY_INTERVAL_MS) return false
    this.last = now
    if (!this.terminal.notify(NOTIFICATION_TITLE, NOTIFICATION_MESSAGE)) this.terminal.bell()
    return true
  }
}

/** The terminal's title: `hushhash (3)` with what is unread, `hushhash` with nothing. */
export function terminalTitle({ count, more }: UnreadCount): string {
  return count === 0 ? 'hushhash' : `hushhash (${count}${more ? '+' : ''})`
}

/** Adds up the unread counts of several conversations. */
export function totalUnread(counts: Iterable<UnreadCount>): UnreadCount {
  let count = 0
  let more = false
  for (const unread of counts) {
    count += unread.count
    more ||= unread.more
  }
  return { count, more }
}
