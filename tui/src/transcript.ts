import { BoxRenderable, ScrollBoxRenderable, StyledText, TextRenderable, dim, fg, t, type CliRenderer } from '@opentui/core'
import { checksumAddress, type Address } from '../../src/shared/address'
import type { DecryptedMessage } from '../../src/shared/protocol-client'
import type { SessionSnapshot } from '../../src/client/lib/conversation-session'
import { fmtRemaining, fmtTime } from '../../src/client/lib/display'
import { terminalText } from '../../src/cli/terminal-text'
import { HELP } from './help'
import { COLORS } from './theme'

/** A command result or error, shown above the messages until replaced or dismissed. */
export interface Feedback {
  text: string
  error: boolean
}

export interface PaneState {
  /** The open conversation, or null before one is opened. */
  partner: Address | null
  snapshot: SessionSnapshot | null
  feedback: Feedback | null
  attentive: boolean
}

/**
 * The conversation pane: its title, a notice for status and problems, and
 * the scrolling messages.
 */
export class Transcript {
  readonly view: BoxRenderable
  private readonly notice: TextRenderable
  private readonly scroll: ScrollBoxRenderable
  private readonly rows = new Map<string, TextRenderable>()
  private order: string[] = []

  constructor(private readonly renderer: CliRenderer, private readonly self: Address) {
    this.view = new BoxRenderable(renderer, { flexGrow: 1, border: true, borderStyle: 'rounded', borderColor: COLORS.border, flexDirection: 'column' })
    this.notice = new TextRenderable(renderer, { content: '', flexShrink: 0, marginBottom: 1 })
    this.scroll = new ScrollBoxRenderable(renderer, { flexGrow: 1, stickyScroll: true, stickyStart: 'bottom' })
    this.view.add(this.notice)
    this.view.add(this.scroll)
  }

  /** Removes every message, for switching to another conversation. */
  reset(): void {
    for (const row of this.rows.values()) { this.scroll.remove(row); row.destroy() }
    this.rows.clear()
    this.order = []
  }

  get atTop(): boolean {
    return this.scroll.scrollTop <= 0
  }

  scrollPage(direction: 1 | -1): void {
    this.scroll.scrollBy(direction, 'viewport')
  }

  /** Draws the title and the notice. */
  renderPane({ partner, snapshot, feedback, attentive }: PaneState): void {
    if (!partner || !snapshot) {
      this.view.title = ' hushhash '
      this.notice.visible = true
      this.notice.content = t`${fg(COLORS.muted)(`Your address is ${checksumAddress(this.self)}\n\nShare it, then start a conversation with /open 0xADDRESS, or pick one on the left.\n\n${HELP}`)}`
      return
    }
    this.view.title = ` ${checksumAddress(partner)} `
    const lines = noticeLines(snapshot, feedback, attentive)
    this.notice.visible = lines.length > 0
    this.notice.content = lines.length ? joinLines(lines) : ''
  }

  /** Draws the messages, adding and removing rows to match `snapshot`. */
  renderMessages(snapshot: SessionSnapshot): void {
    const now = snapshot.now()
    const ids = snapshot.messages.map(message => message.id)
    const keep = new Set(ids)
    for (const [id, row] of this.rows) {
      if (!keep.has(id)) { this.scroll.remove(row); row.destroy(); this.rows.delete(id) }
    }
    if (ids.join() !== this.order.join()) {
      for (const id of this.order) { const row = this.rows.get(id); if (row) this.scroll.remove(row) }
      for (const message of snapshot.messages) {
        const row = this.rows.get(message.id) ?? new TextRenderable(this.renderer, { content: '', wrapMode: 'word' })
        this.rows.set(message.id, row)
        this.scroll.add(row)
      }
      this.order = ids
    }
    for (const message of snapshot.messages) this.rows.get(message.id)!.content = this.messageLine(message, now)
  }

  private messageLine(message: DecryptedMessage, now: number): StyledText {
    const mine = message.sender === this.self
    const who = mine ? fg(COLORS.you)('you ') : fg(COLORS.them)('them')
    const left = message.opened_at === null && mine
      ? `unopened · ${fmtRemaining(message.expires_at, now)}`
      : `${fmtRemaining(message.expires_at, now)} left`
    return t`${dim(fmtTime(message.created_at))} ${who}  ${terminalText(message.plaintext, { newlines: true })}  ${dim(left)}`
  }
}

function noticeLines(snapshot: SessionSnapshot, feedback: Feedback | null, attentive: boolean): StyledText[] {
  const lines: StyledText[] = []
  const problem = (text: string) => lines.push(t`${fg(COLORS.error)(text)}`)
  if (feedback) lines.push(feedback.error ? t`${fg(COLORS.error)(feedback.text)}` : t`${fg(COLORS.muted)(feedback.text)}`)
  if (snapshot.error) problem(`${terminalText(snapshot.error, { newlines: true })} · /retry`)
  if (snapshot.openingFailed) problem('Some new messages could not be opened · /retry')
  if (snapshot.olderError) problem(`${terminalText(snapshot.olderError, { newlines: true })} · PageUp to retry`)
  if (!snapshot.loading && !snapshot.error && snapshot.recipientPubkey === null) problem('This address is not registered on this server, so it cannot receive messages yet')
  if (snapshot.loading) lines.push(t`${dim('Loading…')}`)
  else if (snapshot.loadingOlder) lines.push(t`${dim('Loading older messages…')}`)
  else if (snapshot.hasMore) lines.push(t`${dim('PageUp at the top loads older messages')}`)
  if (!attentive) lines.push(t`${dim('Away: new messages are opened when you come back or press a key')}`)
  return lines
}

function joinLines(lines: StyledText[]): StyledText {
  return new StyledText(lines.flatMap((line, index) => index === 0 ? line.chunks : [...t`${'\n'}`.chunks, ...line.chunks]))
}
