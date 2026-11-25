import {
  BoxRenderable, ScrollBoxRenderable, SelectRenderable, SelectRenderableEvents, StyledText, TextRenderable, TextareaRenderable,
  dim, fg, t, type CliRenderer, type KeyEvent,
} from '@opentui/core'
import { checksumAddress, parseAddress, shortAddress, type Address } from '../../src/shared/address'
import type { LiveEvent } from '../../src/shared/live-events'
import type { DecryptedMessage } from '../../src/shared/protocol-client'
import { ConversationSession } from '../../src/client/lib/conversation-session'
import { fmtDay, fmtRemaining, fmtTime } from '../../src/client/lib/display'
import { errorMessage } from '../../src/client/lib/errors'
import { MESSAGE_LIFETIMES } from '../../src/client/lib/message-lifetime'
import { IDLE_MS, TerminalAttention } from '../../src/cli/attention'
import type { ConnectionEpoch, IdentitySession } from './identity-session'
import { terminalText } from '../../src/cli/terminal-text'

const COLORS = {
  accent: '#7aa2f7', muted: '#737aa2', you: '#9ece6a', them: '#e0af68', error: '#f7768e', border: '#3b4261',
}

const CLEAR_CONFIRM_MS = 10_000

const HELP = [
  'Keys',
  '  Enter              send',
  '  Alt+Enter, Ctrl+J  new line (Shift+Enter too, where the terminal reports it)',
  '  Tab                switch between list and composer',
  '  Click              open a conversation from the list',
  '  PageUp/PageDown    scroll (PageUp at the top loads older)',
  '  Ctrl+C             quit',
  '',
  'Commands',
  '  /open ADDRESS      start or switch conversation (also /new)',
  '  /ttl [5m|300]      lifetime of new messages',
  '  /clear             delete all messages for both of you',
  '  /retry             retry loading or opening',
  '  /older             load older messages',
  '  /address           show your address',
  '  /log               toggle the debug log',
  '  /help              show or hide this help',
  '  /quit              quit (also /exit)',
  '  //text             send text that starts with /',
].join('\n')

/** Every supported lifetime, as one comma-separated line of labels. */
export const LIFETIME_CHOICES_TEXT = MESSAGE_LIFETIMES.map(lifetime => lifetime.label).join(', ')

export function lifetimeLabel(seconds: number): string {
  return MESSAGE_LIFETIMES.find(lifetime => lifetime.seconds === seconds)?.label ?? `${seconds}s`
}

/** Seconds for "300" or a label such as "5m"; null for anything that is not a supported lifetime. */
export function parseLifetime(value: string): number | null {
  const trimmed = value.trim().toLowerCase()
  const numeric = /^\d+$/.test(trimmed)
  const lifetime = MESSAGE_LIFETIMES.find(({ seconds, label }) => numeric ? seconds === Number(trimmed) : label === trimmed)
  return lifetime?.seconds ?? null
}

// Each conversation in the list takes two rows: the address and its last activity.
const LIST_ROWS_PER_ITEM = 2

/**
 * The list item drawn on `row` (0 is the list's top row), or null for the
 * empty space below the last item. Mirrors how OpenTUI's Select scrolls: it
 * keeps the selected item centred where it can. Keep the two in step.
 */
export function listItemAt(row: number, height: number, count: number, selected: number): number | null {
  const visible = Math.max(1, Math.floor(height / LIST_ROWS_PER_ITEM))
  const offset = Math.max(0, Math.min(selected - Math.floor(visible / 2), count - visible))
  const slot = Math.floor(row / LIST_ROWS_PER_ITEM)
  if (row < 0 || slot >= visible) return null
  const index = offset + slot
  return index < count ? index : null
}

export interface AppOptions {
  server: string
  ttl: number
  partner?: Address
  /** How long attention lasts after input in a terminal that has not reported focus. */
  idleMs?: number
}

/**
 * The whole terminal client: a conversation list, the selected conversation
 * and a composer. The selected conversation is a ConversationSession, the
 * same synchronization the browser uses; TerminalAttention plays the part of
 * window attention, so an unfocused or idle terminal neither opens messages
 * nor suppresses push notifications.
 */
export class App {
  private readonly header: TextRenderable
  private readonly footer: TextRenderable
  private readonly sidebar: BoxRenderable
  private readonly list: SelectRenderable
  private readonly pane: BoxRenderable
  private readonly notice: TextRenderable
  private readonly scroll: ScrollBoxRenderable
  private readonly composerBox: BoxRenderable
  private readonly composer: TextareaRenderable

  private readonly rows = new Map<string, TextRenderable>()
  private order: string[] = []
  private conversations: { address: Address; last_message_at: number | null }[] = []
  private readonly unread = new Set<Address>()
  private session: ConversationSession | null = null
  private partner: Address | null = null
  private epoch: ConnectionEpoch | null = null
  private readonly attention: TerminalAttention
  private connected = false
  private status = 'Connecting…'
  private message: { text: string; error: boolean } | null = null
  private ttl: number
  private clearPending: { partner: Address; until: number } | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | undefined
  private readonly tick: ReturnType<typeof setInterval>
  private stopped = false
  private resolveDone!: () => void
  /** Resolves once the app has stopped and released the terminal. */
  readonly done = new Promise<void>(resolve => { this.resolveDone = resolve })

  constructor(private readonly renderer: CliRenderer, private readonly identity: IdentitySession, private readonly options: AppOptions) {
    this.ttl = options.ttl
    this.attention = new TerminalAttention(attentive => this.attentionChanged(attentive), options.idleMs ?? IDLE_MS)
    // Like a browser window's focus: only an attentive terminal suppresses push.
    identity.setAttention(this.attention.attentive)
    const root = new BoxRenderable(renderer, {
      width: '100%', height: '100%', flexDirection: 'column',
      // Mouse events bubble here from every renderable.
      onMouseDown: () => this.attention.input(),
      onMouseScroll: () => this.attention.input(),
    })
    this.header = new TextRenderable(renderer, { content: '', height: 1 })
    const body = new BoxRenderable(renderer, { flexGrow: 1, flexDirection: 'row' })
    this.sidebar = new BoxRenderable(renderer, { width: 26, border: true, borderStyle: 'rounded', borderColor: COLORS.border, title: ' Conversations ' })
    this.list = new SelectRenderable(renderer, {
      flexGrow: 1, options: [], wrapSelection: false, showScrollIndicator: true,
      backgroundColor: 'transparent', focusedBackgroundColor: 'transparent', selectedBackgroundColor: '#292e42',
      textColor: '#c0caf5', selectedTextColor: COLORS.accent, descriptionColor: COLORS.muted,
      onMouseDown: event => {
        if (event.button !== 0) return
        const index = listItemAt(event.y - this.list.screenY, this.list.height, this.list.options.length, this.list.getSelectedIndex())
        const address = index === null ? null : parseAddress(this.list.options[index]?.value)
        if (index === null || !address) return
        event.preventDefault()
        this.list.setSelectedIndex(index)
        this.open(address)
      },
      onMouseScroll: event => {
        if (event.scroll?.direction === 'up') this.list.moveUp()
        else if (event.scroll?.direction === 'down') this.list.moveDown()
      },
    })
    this.list.on(SelectRenderableEvents.ITEM_SELECTED, (_index: number, option: { value?: unknown }) => {
      const address = parseAddress(option.value)
      if (address) this.open(address)
    })
    this.sidebar.add(this.list)
    const main = new BoxRenderable(renderer, { flexGrow: 1, flexDirection: 'column' })
    this.pane = new BoxRenderable(renderer, { flexGrow: 1, border: true, borderStyle: 'rounded', borderColor: COLORS.border, flexDirection: 'column' })
    this.notice = new TextRenderable(renderer, { content: '', flexShrink: 0, marginBottom: 1 })
    this.scroll = new ScrollBoxRenderable(renderer, { flexGrow: 1, stickyScroll: true, stickyStart: 'bottom' })
    this.pane.add(this.notice)
    this.pane.add(this.scroll)
    this.composerBox = new BoxRenderable(renderer, { height: 6, border: true, borderStyle: 'rounded', borderColor: COLORS.border })
    this.composer = new TextareaRenderable(renderer, {
      flexGrow: 1, placeholder: 'Write a message · /help for commands', placeholderColor: COLORS.muted, wrapMode: 'word',
      keyBindings: [
        { name: 'return', action: 'submit' },
        { name: 'return', shift: true, action: 'newline' },
        { name: 'return', meta: true, action: 'newline' },
      ],
      onSubmit: () => this.submit(),
    })
    this.composerBox.add(this.composer)
    main.add(this.pane)
    main.add(this.composerBox)
    body.add(this.sidebar)
    body.add(main)
    this.footer = new TextRenderable(renderer, { content: '', height: 1 })
    root.add(this.header)
    root.add(body)
    root.add(this.footer)
    renderer.root.add(root)

    renderer.keyInput.on('keypress', this.onKey)
    renderer.keyInput.on('paste', this.onPaste)
    renderer.on('focus', this.onFocus)
    renderer.on('blur', this.onBlur)
    // Signals destroy the renderer without asking; stop the same way as /quit.
    renderer.once('destroy', () => this.stop())
    this.tick = setInterval(() => this.renderMessages(), 1000)

    this.focusComposer()
    this.render()
    void this.refreshConversations()
    if (options.partner) this.open(options.partner)
  }

  /** Runs the live connection until the app stops. */
  async run(): Promise<void> {
    void this.identity.live({
      event: event => this.liveEvent(event),
      connection: epoch => {
        this.epoch = epoch
        this.connected = epoch !== null
        this.session?.connectionChanged(epoch)
        if (epoch) void this.refreshConversations()
        this.render()
      },
      status: text => { this.status = text; this.render() },
    }).catch(error => {
      if (!this.identity.signal.aborted) this.show(errorMessage(error, 'Live connection failed'), true)
    })
    // An outdated client stops itself; the app follows so main can explain.
    this.identity.signal.addEventListener('abort', () => this.stop(), { once: true })
    await this.done
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    clearInterval(this.tick)
    clearTimeout(this.refreshTimer)
    this.attention.dispose()
    this.session?.dispose()
    this.session = null
    this.identity.abort()
    this.renderer.keyInput.off('keypress', this.onKey)
    this.renderer.keyInput.off('paste', this.onPaste)
    this.renderer.off('focus', this.onFocus)
    this.renderer.off('blur', this.onBlur)
    this.renderer.destroy()
    this.resolveDone()
  }

  private readonly onFocus = () => this.attention.focus()
  private readonly onBlur = () => this.attention.blur()
  private readonly onPaste = () => this.attention.input()

  private attentionChanged(attentive: boolean): void {
    this.identity.setAttention(attentive)
    this.session?.attentionChanged(attentive)
    this.render()
  }

  private readonly onKey = (key: KeyEvent) => {
    this.attention.input()
    if (key.ctrl && key.name === 'c') {
      key.preventDefault()
      this.stop()
    } else if (key.name === 'tab' && !key.ctrl && !key.meta) {
      key.preventDefault()
      if (this.composer.focused) this.focusList()
      else this.focusComposer()
    } else if (key.name === 'escape' && this.composer.focused) {
      key.preventDefault()
      this.focusList()
    } else if (key.name === 'pageup') {
      key.preventDefault()
      if (this.scroll.scrollTop <= 0) void this.session?.fetchOlder()
      else this.scroll.scrollBy(-1, 'viewport')
    } else if (key.name === 'pagedown') {
      key.preventDefault()
      this.scroll.scrollBy(1, 'viewport')
    }
  }

  private focusComposer(): void {
    this.composer.focus()
    this.composerBox.borderColor = COLORS.accent
    this.sidebar.borderColor = COLORS.border
  }

  private focusList(): void {
    this.list.focus()
    this.sidebar.borderColor = COLORS.accent
    this.composerBox.borderColor = COLORS.border
  }

  private show(text: string, error = false): void {
    this.message = { text, error }
    this.render()
  }

  private liveEvent(event: LiveEvent): void {
    this.session?.liveEvent(event)
    if (event.type !== 'message') return
    const { sender, recipient } = event.data
    const partner = sender === this.identity.address ? recipient : sender
    if (partner !== this.partner && sender !== this.identity.address) this.unread.add(partner)
    this.scheduleConversationRefresh()
    this.renderList()
  }

  private scheduleConversationRefresh(): void {
    clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => void this.refreshConversations(), 500)
  }

  private async refreshConversations(): Promise<boolean> {
    try {
      const { conversations: listed } = await this.identity.conversations()
      if (this.stopped) return false
      const known = new Set(listed.map(conversation => conversation.address))
      // Conversations opened here stay listed before their first message.
      const local = this.conversations.filter(conversation => !known.has(conversation.address))
      this.conversations = [...local, ...[...listed].sort((a, b) => b.last_message_at - a.last_message_at)]
      this.renderList()
      return true
    } catch (error) {
      if (!this.identity.signal.aborted) this.show(`Could not load conversations: ${errorMessage(error, 'unknown error')}`, true)
      return false
    }
  }

  open(partner: Address): void {
    if (partner === this.identity.address) { this.show('That is your own address', true); return }
    if (partner !== this.partner) {
      this.session?.dispose()
      for (const row of this.rows.values()) { this.scroll.remove(row); row.destroy() }
      this.rows.clear()
      this.order = []
      this.partner = partner
      this.clearPending = null
      this.session = new ConversationSession({
        self: this.identity.address,
        partner,
        protocol: this.identity.protocol(partner, () => this.refreshConversations()),
        decrypt: this.identity.decryptor(partner),
        connection: this.epoch,
        attentive: this.attention.attentive,
      })
      this.session.subscribe(() => this.render())
    }
    this.unread.delete(partner)
    if (!this.conversations.some(conversation => conversation.address === partner)) {
      this.conversations.unshift({ address: partner, last_message_at: null })
    }
    this.message = null
    this.focusComposer()
    this.render()
  }

  private submit(): void {
    const text = this.composer.plainText
    if (!text.trim()) return
    // Commands and the // escape are one line; pasted text that merely starts with / is a message.
    const oneLine = !text.trim().includes('\n')
    if (oneLine && text.startsWith('/') && !text.startsWith('//')) {
      this.composer.clear()
      // Keep a mistyped command for fixing.
      if (!this.command(text.trim())) this.composer.setText(text)
      return
    }
    const session = this.session
    if (!session) { this.show('Open a conversation first: /open ADDRESS', true); return }
    const plaintext = oneLine && text.startsWith('//') ? text.slice(1) : text
    this.composer.clear()
    this.message = null
    this.render()
    session.send(plaintext, this.ttl).catch(error => {
      // Nothing typed is lost: a failed message goes back to an empty composer.
      if (!this.composer.plainText) this.composer.setText(text)
      this.show(`Send failed: ${errorMessage(error, 'unknown error')}. It may still have arrived; check before resending.`, true)
    })
  }

  /** Runs a command line; false if there is no such command. */
  private command(line: string): boolean {
    const [name, ...args] = line.split(/\s+/)
    const arg = args.join(' ')
    switch (name) {
      case '/open':
      case '/new': {
        const address = parseAddress(arg)
        if (!address) this.show('Usage: /open 0xADDRESS', true)
        else this.open(address)
        return true
      }
      case '/ttl': {
        if (!arg) { this.show(`Lifetime ${lifetimeLabel(this.ttl)}. Choose: ${LIFETIME_CHOICES_TEXT}`); return true }
        const seconds = parseLifetime(arg)
        if (seconds === null) { this.show(`Choose a lifetime: ${LIFETIME_CHOICES_TEXT}`, true); return true }
        this.ttl = seconds
        this.show(`New messages disappear ${lifetimeLabel(seconds)} after they are opened`)
        return true
      }
      case '/clear': {
        const session = this.session
        const partner = this.partner
        if (!session || !partner) { this.show('Open a conversation first', true); return true }
        if (this.clearPending?.partner !== partner || Date.now() > this.clearPending.until) {
          this.clearPending = { partner, until: Date.now() + CLEAR_CONFIRM_MS }
          this.show('Type /clear again within 10 seconds to delete every message in this conversation for both of you', true)
          return true
        }
        this.clearPending = null
        session.clear()
          .then(() => this.show('Conversation cleared for both of you'))
          .catch(error => this.show(`Clear failed: ${errorMessage(error, 'unknown error')}`, true))
        return true
      }
      case '/retry':
        if (this.session?.snapshot().openingFailed) this.session.retryOpening()
        else this.session?.retry()
        this.message = null
        this.render()
        return true
      case '/older':
        void this.session?.fetchOlder()
        return true
      case '/address':
        this.show(`Your address: ${checksumAddress(this.identity.address)}`)
        return true
      case '/log':
        this.renderer.console.toggle()
        return true
      case '/help':
        if (this.message?.text === HELP) { this.message = null; this.render() }
        else this.show(HELP)
        return true
      case '/quit':
      case '/exit':
        this.stop()
        return true
      default:
        this.show(`Unknown command ${terminalText(name ?? '')}. /help lists commands; //text sends text starting with /`, true)
        return false
    }
  }

  private render(): void {
    if (this.stopped) return
    this.header.content = t` ${fg(COLORS.accent)('hushhash')}  ${checksumAddress(this.identity.address)} ${dim('(you)')}  ${dim(this.options.server)}`
    const connection = this.connected ? fg(COLORS.you)('● connected') : fg(COLORS.error)(`○ ${terminalText(this.status)}`)
    const focus = this.attention.attentive ? '' : '  · away: new messages stay unopened'
    this.footer.content = t` ${connection}  ${dim(`lifetime ${lifetimeLabel(this.ttl)}`)}${dim(focus)}  ${dim('· /help')}`
    this.renderList()
    this.renderPane()
    this.renderMessages()
  }

  private renderList(): void {
    const options = this.conversations.map(({ address, last_message_at }) => ({
      name: `${this.unread.has(address) ? '● ' : '  '}${shortAddress(address)}`,
      description: last_message_at === null ? '  new' : `  ${fmtDay(last_message_at) ?? fmtTime(last_message_at)}`,
      value: address,
    }))
    const selected = this.list.getSelectedIndex()
    const highlighted = this.list.options[selected]?.value
    this.list.options = options
    const index = options.findIndex(option => option.value === (highlighted ?? this.partner))
    if (index >= 0 && index !== this.list.getSelectedIndex()) this.list.setSelectedIndex(index)
  }

  private renderPane(): void {
    const partner = this.partner
    const session = this.session
    if (!partner || !session) {
      this.pane.title = ' hushhash '
      this.notice.visible = true
      this.notice.content = t`${fg(COLORS.muted)(`Your address is ${checksumAddress(this.identity.address)}\n\nShare it, then start a conversation with /open 0xADDRESS, or pick one on the left.\n\n${HELP}`)}`
      return
    }
    this.pane.title = ` ${checksumAddress(partner)} `
    const snapshot = session.snapshot()
    const lines: StyledText[] = []
    const problem = (text: string) => lines.push(t`${fg(COLORS.error)(text)}`)
    if (this.message) lines.push(this.message.error ? t`${fg(COLORS.error)(this.message.text)}` : t`${fg(COLORS.muted)(this.message.text)}`)
    if (snapshot.error) problem(`${terminalText(snapshot.error, { newlines: true })} · /retry`)
    if (snapshot.openingFailed) problem('Some new messages could not be opened · /retry')
    if (snapshot.olderError) problem(`${terminalText(snapshot.olderError, { newlines: true })} · PageUp to retry`)
    if (!snapshot.loading && !snapshot.error && snapshot.recipientPubkey === null) problem('This address is not registered on this server, so it cannot receive messages yet')
    if (snapshot.loading) lines.push(t`${dim('Loading…')}`)
    else if (snapshot.loadingOlder) lines.push(t`${dim('Loading older messages…')}`)
    else if (snapshot.hasMore) lines.push(t`${dim('PageUp at the top loads older messages')}`)
    if (!this.attention.attentive) lines.push(t`${dim('Away: new messages are opened when you come back or press a key')}`)
    this.notice.visible = lines.length > 0
    this.notice.content = lines.length ? joinLines(lines) : ''
  }

  private renderMessages(): void {
    const session = this.session
    if (this.stopped || !session) return
    const snapshot = session.snapshot()
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
    const mine = message.sender === this.identity.address
    const who = mine ? fg(COLORS.you)('you ') : fg(COLORS.them)('them')
    const left = message.opened_at === null && mine
      ? `unopened · ${fmtRemaining(message.expires_at, now)}`
      : `${fmtRemaining(message.expires_at, now)} left`
    return t`${dim(fmtTime(message.created_at))} ${who}  ${terminalText(message.plaintext, { newlines: true })}  ${dim(left)}`
  }
}

function joinLines(lines: StyledText[]): StyledText {
  return new StyledText(lines.flatMap((line, index) => index === 0 ? line.chunks : [...t`${'\n'}`.chunks, ...line.chunks]))
}
