import { BoxRenderable, ScrollBoxRenderable, StyledText, TextRenderable, dim, fg, t, type CliRenderer } from '@opentui/core'
import { checksumAddress, shortAddress, type Address } from '../../src/shared/address'
import type { SessionSnapshot } from '../../src/client/lib/conversation-session'
import { fmtTime } from '../../src/client/lib/display'
import { terminalText } from '../../src/cli/terminal-text'
import { AVATAR_COLUMNS, avatarGrid, avatarRows, canDrawAvatars } from './avatar'
import { HELP } from './help'
import { layoutRows, messageMeta, type ExpiryTone, type MessageState, type RowLayout, type ShownMessage } from './message-view'
import { COLORS, themeName } from './theme'

export interface PaneState {
  /** The open conversation, or null before one is opened. */
  partner: Address | null
  snapshot: SessionSnapshot | null
  attentive: boolean
  /** The list is a screen of its own, so the header says how to get back to it. */
  collapsed: boolean
}

/** A bubble is at most this share of the pane wide. */
const BUBBLE_WIDTH = '70%'

const TONE_COLOR: Record<ExpiryTone, () => string> = {
  normal: () => COLORS.muted,
  warning: () => COLORS.warning,
  critical: () => COLORS.error,
}

const STATE_COLOR: Record<MessageState, () => string> = {
  sending: () => COLORS.muted,
  unopened: () => COLORS.muted,
  opened: () => COLORS.ok,
  failed: () => COLORS.error,
}

/** One message: a day label and new-messages divider above it if due, its header, then its bubble. */
class MessageRow {
  readonly view: BoxRenderable
  private readonly day: TextRenderable
  private readonly divider: TextRenderable
  private readonly header: TextRenderable
  private readonly bubble: BoxRenderable
  private readonly text: TextRenderable
  private readonly meta: TextRenderable

  constructor(renderer: CliRenderer, readonly mine: boolean) {
    const side = mine ? 'flex-end' : 'flex-start'
    this.view = new BoxRenderable(renderer, { flexDirection: 'column', flexShrink: 0, paddingX: 1 })
    this.day = new TextRenderable(renderer, { content: '', alignSelf: 'center', marginTop: 1 })
    this.divider = new TextRenderable(renderer, { content: '', alignSelf: 'center' })
    this.header = new TextRenderable(renderer, { content: '', alignSelf: side })
    this.bubble = new BoxRenderable(renderer, { flexDirection: 'row', maxWidth: BUBBLE_WIDTH, paddingX: 1, alignSelf: side, flexShrink: 0 })
    this.text = new TextRenderable(renderer, { content: '', wrapMode: 'word', flexShrink: 1 })
    this.meta = new TextRenderable(renderer, { content: '', flexShrink: 0, marginLeft: 2 })
    this.bubble.add(this.text)
    this.bubble.add(this.meta)
    for (const part of [this.day, this.divider, this.header, this.bubble]) this.view.add(part)
  }

  render(layout: RowLayout, message: ShownMessage, partnerLabel: string, now: number): void {
    this.day.visible = layout.day !== null
    if (layout.day !== null) this.day.content = t`${fg(COLORS.muted)(`── ${layout.day} ──`)}`
    this.divider.visible = layout.firstNew
    if (layout.firstNew) this.divider.content = t`${fg(COLORS.accent)('── new ──')}`
    this.header.visible = layout.header
    // A gap above each group, unless a label already makes one.
    this.header.marginTop = layout.header && layout.day === null && !layout.firstNew ? 1 : 0
    if (layout.header) {
      this.header.content = this.mine
        ? t`${dim(fmtTime(message.created_at))} ${fg(COLORS.you)('you')}`
        : t`${fg(COLORS.them)(partnerLabel)} ${dim(fmtTime(message.created_at))}`
    }
    const meta = messageMeta(message, this.mine, now)
    this.bubble.backgroundColor = this.mine ? COLORS.bubbleYou : COLORS.bubbleThem
    // The text fades in its last seconds, before it disappears.
    this.text.fg = meta.tone === 'critical' ? COLORS.muted : COLORS.text
    this.text.content = terminalText(message.plaintext, { newlines: true })
    const label = fg(meta.state === 'failed' ? COLORS.error : TONE_COLOR[meta.tone]())(meta.label)
    this.meta.content = meta.icon ? t`${label} ${fg(STATE_COLOR[meta.state]())(meta.icon)}` : t`${label}`
  }

  destroy(): void {
    this.view.destroyRecursively()
  }
}

/**
 * The conversation pane: a header with your partner's avatar and address,
 * a notice for the conversation's state and problems, and the scrolling
 * messages, yours on the right and theirs on the left.
 */
export class Transcript {
  readonly view: BoxRenderable
  private readonly header: BoxRenderable
  private readonly avatar: TextRenderable
  private readonly title: TextRenderable
  private readonly notice: TextRenderable
  private readonly scroll: ScrollBoxRenderable
  private readonly rows = new Map<string, MessageRow>()
  private order: string[] = []

  constructor(private readonly renderer: CliRenderer, private readonly self: Address) {
    this.view = new BoxRenderable(renderer, { flexGrow: 1, border: true, borderStyle: 'rounded', flexDirection: 'column' })
    this.header = new BoxRenderable(renderer, { flexDirection: 'row', flexShrink: 0, gap: 1, paddingX: 1, marginBottom: 1 })
    this.avatar = new TextRenderable(renderer, { content: '', flexShrink: 0, width: AVATAR_COLUMNS })
    this.title = new TextRenderable(renderer, { content: '', flexShrink: 1 })
    this.header.add(this.avatar)
    this.header.add(this.title)
    this.notice = new TextRenderable(renderer, { content: '', flexShrink: 0, marginBottom: 1, paddingX: 1 })
    this.scroll = new ScrollBoxRenderable(renderer, { flexGrow: 1, stickyScroll: true, stickyStart: 'bottom' })
    this.view.add(this.header)
    this.view.add(this.notice)
    this.view.add(this.scroll)
    this.applyTheme()
  }

  /** Repaints with the current palette; the rows follow on their next render. */
  applyTheme(): void {
    this.view.borderColor = COLORS.border
    this.view.titleColor = COLORS.text
  }

  /** Removes every message, for switching to another conversation. */
  reset(): void {
    for (const row of this.rows.values()) { this.scroll.remove(row.view); row.destroy() }
    this.rows.clear()
    this.order = []
    this.scroll.scrollTo(Infinity)
  }

  get atTop(): boolean {
    return this.scroll.scrollTop <= 0
  }

  scrollPage(direction: 1 | -1): void {
    this.scroll.scrollBy(direction, 'viewport')
  }

  /** Draws the header and the notice. */
  renderPane({ partner, snapshot, attentive, collapsed }: PaneState): void {
    const back = collapsed ? t`${fg(COLORS.accent)('← conversations')} ${dim('Tab')}` : null
    if (!partner || !snapshot) {
      this.view.title = ' hushhash '
      this.header.visible = back !== null
      this.avatar.visible = false
      if (back) this.title.content = back
      this.notice.visible = true
      this.notice.content = t`${fg(COLORS.muted)(`Your address is ${checksumAddress(this.self)}\n\nShare it, then start a conversation with /open 0xADDRESS, or pick one on the left.\n\n${HELP}`)}`
      return
    }
    this.view.title = ''
    this.header.visible = true
    this.avatar.visible = canDrawAvatars(this.renderer.capabilities)
    if (this.avatar.visible) this.avatar.content = joinLines(avatarRows(avatarGrid(partner, themeName())))
    this.title.content = joinLines([
      t`${fg(COLORS.them)(checksumAddress(partner))}`,
      back ?? t`${dim('End-to-end encrypted · messages disappear after they are opened')}`,
    ])
    const lines = noticeLines(snapshot, attentive)
    this.notice.visible = lines.length > 0
    this.notice.content = lines.length ? joinLines(lines) : ''
  }

  /**
   * Draws `messages`, adding and removing rows to match. Rows are kept by
   * key and only redrawn, so the one-second tick rebuilds nothing.
   */
  renderMessages(messages: readonly ShownMessage[], partner: Address, now: number, firstNewKey: string | null): void {
    const keys = messages.map(message => message.key)
    const keep = new Set(keys)
    for (const [key, row] of this.rows) {
      if (!keep.has(key)) { this.scroll.remove(row.view); row.destroy(); this.rows.delete(key) }
    }
    if (keys.join() !== this.order.join()) {
      for (const key of this.order) { const row = this.rows.get(key); if (row) this.scroll.remove(row.view) }
      for (const message of messages) {
        const mine = message.sender === this.self
        let row = this.rows.get(message.key)
        if (!row || row.mine !== mine) {
          row?.destroy()
          row = new MessageRow(this.renderer, mine)
          this.rows.set(message.key, row)
        }
        this.scroll.add(row.view)
      }
      this.order = keys
    }
    const layouts = layoutRows(messages, this.self, now, firstNewKey)
    const label = shortAddress(partner)
    messages.forEach((message, index) => this.rows.get(message.key)!.render(layouts[index]!, message, label, now))
  }
}

function noticeLines(snapshot: SessionSnapshot, attentive: boolean): StyledText[] {
  const lines: StyledText[] = []
  const problem = (text: string) => lines.push(t`${fg(COLORS.error)(text)}`)
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

export function joinLines(lines: StyledText[]): StyledText {
  return new StyledText(lines.flatMap((line, index) => index === 0 ? line.chunks : [...t`${'\n'}`.chunks, ...line.chunks]))
}
