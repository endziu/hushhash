import type { CliRenderer, KeyEvent, ThemeMode } from '@opentui/core'
import { checksumAddress, type Address } from '../../src/shared/address'
import type { LiveEvent } from '../../src/shared/live-events'
import { ConversationSession } from '../../src/client/lib/conversation-session'
import { errorMessage } from '../../src/client/lib/errors'
import { displayName } from '../../src/client/lib/display'
import { IDLE_MS, TerminalAttention } from '../../src/cli/attention'
import { terminalText } from '../../src/cli/terminal-text'
import type { ConnectionEpoch, IdentitySession, LiveStatus } from './identity-session'
import { Commands, classifyInput } from './commands'
import { HELP_MODAL } from './help'
import { Composer } from './composer'
import { Layout } from './layout'
import { Sidebar, type ConversationEntry } from './sidebar'
import { COMPOSER_HINTS, HintBar, LIST_HINTS, UNFOCUSED_HINTS } from './hints'
import { StatusBar } from './status-bar'
import { Modals } from './modals'
import { Toasts, type ToastKind } from './toasts'
import { Transcript } from './transcript'
import { NewMessages, newestAccepted } from './message-view'
import { Outbox } from './outbox'
import { resolveTheme, setTheme, type ThemeSetting } from './theme'
import { NAME_MAX_LENGTH, TuiState } from './state'
import { UnreadCounts, unreadBadge } from './unread'

// How many of a conversation's newest messages are fetched to count its unread ones.
const UNREAD_PAGE = 20

export interface AppOptions {
  server: string
  ttl: number
  partner?: Address
  /** Default: system, which follows the terminal's background. */
  theme?: ThemeSetting
  /** How long attention lasts after input in a terminal that has not reported focus. */
  idleMs?: number
  /** Names, last-seen times and removed conversations; default: kept in memory only. */
  state?: TuiState
}

/**
 * The whole terminal client: a conversation list, the selected conversation
 * and a composer. The selected conversation is a ConversationSession, the
 * same synchronization the browser uses; TerminalAttention plays the part of
 * window attention, so an unfocused or idle terminal neither opens messages
 * nor suppresses push notifications.
 */
export class App {
  private readonly statusBar: StatusBar
  private readonly hintBar: HintBar
  private readonly sidebar: Sidebar
  private readonly transcript: Transcript
  private readonly composer: Composer
  private readonly commands: Commands
  private readonly modals: Modals
  private readonly toasts: Toasts
  private readonly layout: Layout

  private conversations: ConversationEntry[] = []
  private readonly state: TuiState
  private readonly unread = new UnreadCounts()
  /** Conversations whose unread count is being fetched. */
  private readonly counting = new Set<Address>()
  /** The newest message on screen when you switched away from each conversation, if any. */
  private readonly lastLooked = new Map<Address, number | null>()
  private session: ConversationSession | null = null
  private partner: Address | null = null
  private readonly outbox: Outbox
  private readonly newMessages = new NewMessages()
  private themeSetting: ThemeSetting
  private terminalTheme: ThemeMode | null
  private epoch: ConnectionEpoch | null = null
  private readonly attention: TerminalAttention
  private live: LiveStatus = { state: 'connecting' }
  private ttl: number
  private refreshTimer: ReturnType<typeof setTimeout> | undefined
  private readonly tick: ReturnType<typeof setInterval>
  private stopped = false
  private resolveDone!: () => void
  /** Resolves once the app has stopped and released the terminal. */
  readonly done = new Promise<void>(resolve => { this.resolveDone = resolve })

  constructor(private readonly renderer: CliRenderer, private readonly identity: IdentitySession, private readonly options: AppOptions) {
    this.ttl = options.ttl
    this.state = options.state ?? TuiState.memory(identity.address)
    let saveFailed = false
    this.state.onError = error => {
      // Once: every later change would fail the same way.
      if (saveFailed) return
      saveFailed = true
      this.toast(`Could not save names and read state: ${errorMessage(error, 'unknown error')}`, 'error')
    }
    this.themeSetting = options.theme ?? 'system'
    this.terminalTheme = renderer.themeMode
    setTheme(resolveTheme(this.themeSetting, this.terminalTheme))
    this.outbox = new Outbox(identity.address)
    this.attention = new TerminalAttention(attentive => this.attentionChanged(attentive), options.idleMs ?? IDLE_MS)
    // Like a browser window's focus: only an attentive terminal suppresses push.
    identity.setAttention(this.attention.attentive)

    this.sidebar = new Sidebar(renderer, address => this.open(address))
    this.transcript = new Transcript(renderer, identity.address)
    this.composer = new Composer(renderer, () => this.submit())
    this.statusBar = new StatusBar(renderer, identity.address, options.server)
    this.hintBar = new HintBar(renderer)
    this.layout = new Layout(renderer, {
      statusBar: this.statusBar.view, sidebar: this.sidebar, pane: this.transcript.view,
      composer: this.composer.view, hintBar: this.hintBar.view,
    }, () => this.attention.input())
    const root = this.layout.root
    this.modals = new Modals(renderer, root, () => this.renderHints())
    this.modals.applyTheme()
    // A collapsed layout shows whichever of the two last had focus, also after a click.
    this.composer.onFocusChange(focused => { if (focused) this.showList(false); this.renderHints() })
    this.sidebar.onFocusChange(focused => { if (focused) this.showList(true); this.renderHints() })
    this.toasts = new Toasts(renderer, root)
    this.commands = new Commands({
      address: identity.address,
      session: () => this.session,
      ttl: () => this.ttl,
      setTtl: seconds => { this.ttl = seconds; this.render() },
      theme: () => this.themeSetting,
      setTheme: setting => this.setThemeSetting(setting),
      partner: () => this.partner,
      open: address => this.open(address),
      rename: (address, name) => this.rename(address, name),
      remove: address => this.confirmRemove(address),
      toast: (text, kind) => this.toast(text, kind),
      modal: options => this.modals.show(options),
      confirm: options => this.modals.confirm(options),
      toggleLog: () => this.renderer.console.toggle(),
      quit: () => this.stop(),
    })

    renderer.keyInput.on('keypress', this.onKey)
    renderer.keyInput.on('paste', this.onPaste)
    renderer.on('focus', this.onFocus)
    renderer.on('blur', this.onBlur)
    renderer.on('resize', this.onResize)
    renderer.on('theme_mode', this.onThemeMode)
    renderer.on('capabilities', this.onCapabilities)
    // Signals destroy the renderer without asking; stop the same way as /quit.
    renderer.once('destroy', () => this.stop())
    this.tick = setInterval(() => { this.renderStatus(); this.renderMessages() }, 1000)

    this.composer.focus()
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
        this.session?.connectionChanged(epoch)
        if (epoch) void this.refreshConversations()
        this.render()
      },
      status: live => { this.live = live; this.renderStatus() },
    }).catch(error => {
      if (!this.identity.signal.aborted) this.toast(errorMessage(error, 'Live connection failed'), 'error')
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
    // Settles a pending /clear confirmation as cancelled.
    this.modals.close()
    this.toasts.dispose()
    this.session?.dispose()
    this.session = null
    this.identity.abort()
    this.renderer.keyInput.off('keypress', this.onKey)
    this.renderer.keyInput.off('paste', this.onPaste)
    this.renderer.off('focus', this.onFocus)
    this.renderer.off('blur', this.onBlur)
    this.renderer.off('resize', this.onResize)
    this.renderer.off('theme_mode', this.onThemeMode)
    this.renderer.off('capabilities', this.onCapabilities)
    this.renderer.destroy()
    this.resolveDone()
  }

  private readonly onFocus = () => this.attention.focus()
  private readonly onBlur = () => this.attention.blur()
  private readonly onPaste = () => this.attention.input()
  private readonly onResize = () => {
    this.layout.fitToTerminal()
    this.composer.fit()
    this.render()
  }

  // Avatars are drawn once the terminal says it has the colours.
  private readonly onCapabilities = () => this.render()

  private readonly onThemeMode = (mode: ThemeMode) => {
    this.terminalTheme = mode
    if (this.themeSetting === 'system') this.applyTheme()
  }

  private setThemeSetting(setting: ThemeSetting): void {
    this.themeSetting = setting
    this.applyTheme()
  }

  private applyTheme(): void {
    setTheme(resolveTheme(this.themeSetting, this.terminalTheme))
    this.sidebar.applyTheme()
    this.composer.applyTheme()
    this.transcript.applyTheme()
    this.modals.applyTheme()
    this.toasts.applyTheme()
    this.render()
  }

  /** The newest acceptance time in the open conversation: server time, unlike the local clock. */
  private newestShown(): number | null {
    return this.session ? newestAccepted(this.session.snapshot().messages) : null
  }

  private attentionChanged(attentive: boolean): void {
    if (!attentive) this.newMessages.away(this.newestShown())
    this.identity.setAttention(attentive)
    this.session?.attentionChanged(attentive)
    this.render()
  }

  private readonly onKey = (key: KeyEvent) => {
    this.attention.input()
    if (key.ctrl && key.name === 'c') {
      key.preventDefault()
      this.stop()
    } else if (this.modals.handleKey(key)) {
      // An open modal takes every other key.
    } else if (key.name === 'f1' || (key.name === '?' && this.sidebar.focused)) {
      key.preventDefault()
      void this.modals.show(HELP_MODAL)
    } else if (this.sidebar.focused && !key.ctrl && !key.meta && (key.name === 'r' || key.name === 'd')) {
      key.preventDefault()
      const address = this.sidebar.highlighted
      if (address && key.name === 'r') void this.promptName(address)
      else if (address) void this.confirmRemove(address)
    } else if (key.name === 'tab' && !key.ctrl && !key.meta) {
      key.preventDefault()
      if (this.composer.focused) this.focusList()
      else this.focusComposer()
    } else if (key.name === 'escape' && this.composer.focused) {
      key.preventDefault()
      this.focusList()
    } else if (key.name === 'escape' && this.sidebar.focused && this.layout.collapsed && this.partner) {
      key.preventDefault()
      this.focusComposer()
    } else if (key.ctrl && key.name === 'b') {
      key.preventDefault()
      this.toggleSidebar()
    } else if (key.name === 'pageup') {
      key.preventDefault()
      if (this.transcript.atTop) void this.session?.fetchOlder()
      else this.transcript.scrollPage(-1)
    } else if (key.name === 'pagedown') {
      key.preventDefault()
      this.transcript.scrollPage(1)
    }
  }

  private focusList(): void {
    this.showList(true)
    this.sidebar.focus()
  }

  private focusComposer(): void {
    this.showList(false)
    this.composer.focus()
  }

  private showList(list: boolean): void {
    const visible = this.layout.listVisible
    this.layout.showList(list)
    if (this.layout.listVisible !== visible) this.render()
  }

  /** Hides or shows the sidebar; in a terminal too narrow for one, switches screens. */
  private toggleSidebar(): void {
    if (this.layout.narrow) {
      if (this.sidebar.focused) this.focusComposer()
      else this.focusList()
      return
    }
    this.layout.toggleSidebar()
    if (this.layout.collapsed && this.sidebar.focused) this.focusComposer()
    this.render()
  }

  private toast(text: string, kind: ToastKind = 'info'): void {
    if (!this.stopped) this.toasts.show(text, kind)
  }

  private liveEvent(event: LiveEvent): void {
    this.session?.liveEvent(event)
    if (event.type === 'conversation-cleared') {
      const { address, cleared_at } = event.data
      // Nothing from before the clear is left to read.
      this.state.markSeen(address, cleared_at)
      this.unread.forget(address, cleared_at)
      if (address === this.partner) {
        this.outbox.clear()
        this.renderMessages()
      }
      this.renderList()
    }
    if (event.type !== 'message') return
    const { id, sender, recipient, created_at } = event.data
    const partner = sender === this.identity.address ? recipient : sender
    const looking = partner === this.partner && this.attention.attentive
    // Seen as it arrives, so not new later.
    if (looking) this.newMessages.arrivedWhileLooking(id)
    // Opened as it arrives; the next count says if it was not.
    else if (sender !== this.identity.address) this.unread.arrived(partner, id, created_at)
    this.scheduleConversationRefresh()
    this.renderList()
  }

  /** Records how far the open conversation has been read: through the newest message opened or sent. */
  private noteSeen(): void {
    const seen = this.session?.snapshot().seenThrough ?? null
    if (this.partner && seen !== null) this.state.markSeen(this.partner, seen)
  }

  /** Fetches the unread count of each listed conversation that has activity since it was last counted. */
  private countUnread(): void {
    for (const { address, last_message_at } of this.conversations) {
      if (last_message_at === null || this.counting.has(address)) continue
      if (!this.unread.needsFetch(address, last_message_at, this.state.unreadAfter(address))) continue
      this.counting.add(address)
      this.identity.recentStamps(address, UNREAD_PAGE).then(({ messages, full }) => {
        this.counting.delete(address)
        this.unread.fetched(address, messages, full, last_message_at)
        this.renderList()
        // Activity while it was being fetched needs counting too.
        if (!this.stopped) this.countUnread()
      }, () => {
        // The count stays as it was; the next activity tries again.
        this.counting.delete(address)
      })
    }
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
      // Removed here, until newer activity.
      const shown = listed.filter(conversation => !this.state.isRemoved(conversation.address, conversation.last_message_at))
      this.conversations = [...local, ...shown.sort((a, b) => b.last_message_at - a.last_message_at)]
      this.renderList()
      this.countUnread()
      return true
    } catch (error) {
      if (!this.identity.signal.aborted) this.toast(`Could not load conversations: ${errorMessage(error, 'unknown error')}`, 'error')
      return false
    }
  }

  open(partner: Address): void {
    if (partner === this.identity.address) { this.toast('That is your own address', 'error'); return }
    if (partner !== this.partner) {
      if (this.partner) this.lastLooked.set(this.partner, this.newestShown())
      this.session?.dispose()
      this.transcript.reset()
      this.outbox.clear()
      // Mark what arrived after the newest message you saw here, or after the last you read.
      const after = this.state.unreadAfter(partner)
      const since = this.lastLooked.get(partner) ?? (this.unread.count(partner, after).count > 0 ? after : null)
      this.newMessages.reset(since)
      this.partner = partner
      this.session = new ConversationSession({
        self: this.identity.address,
        partner,
        protocol: this.identity.protocol(partner, () => this.refreshConversations()),
        decrypt: this.identity.decryptor(partner),
        connection: this.epoch,
        attentive: this.attention.attentive,
      })
      this.session.subscribe(() => { this.noteSeen(); this.render() })
    }
    if (!this.conversations.some(conversation => conversation.address === partner)) {
      this.conversations.unshift({ address: partner, last_message_at: null })
    }
    // A modal keeps focus; closing it gives focus back.
    if (!this.modals.isOpen) this.focusComposer()
    this.render()
  }

  /** Asks for a name for the conversation with `address`. */
  private async promptName(address: Address): Promise<void> {
    const name = await this.modals.prompt({
      title: 'Name conversation',
      label: `A name for ${checksumAddress(address)}. It stays on this device. Leave it empty to remove the name.`,
      value: this.state.name(address) ?? '',
      placeholder: 'Name',
      validate: value => [...value.trim()].length > NAME_MAX_LENGTH ? `At most ${NAME_MAX_LENGTH} characters` : null,
    })
    if (name !== null) this.rename(address, name)
  }

  private rename(address: Address, name: string): void {
    const kept = this.state.setName(address, name)
    this.toast(kept ? `Named ${terminalText(kept)}` : 'Name removed', 'success')
    this.render()
  }

  /** Asks, then takes the conversation with `address` off this device's list. */
  private async confirmRemove(address: Address): Promise<void> {
    const confirmed = await this.modals.confirm({
      title: 'Remove conversation',
      body: `Remove ${this.label(address)} from the list on this device, and forget its name? `
        + 'Its messages stay on the server (/clear deletes them), and it comes back if a new message arrives.',
      action: 'Remove',
    })
    if (confirmed && !this.stopped) this.remove(address)
  }

  private remove(address: Address): void {
    const lastMessageAt = this.conversations.find(conversation => conversation.address === address)?.last_message_at ?? null
    this.state.remove(address, lastMessageAt)
    this.unread.forget(address, lastMessageAt)
    this.lastLooked.delete(address)
    this.conversations = this.conversations.filter(conversation => conversation.address !== address)
    if (address === this.partner) this.close()
    this.toast('Conversation removed from this device', 'success')
    this.render()
  }

  /** Closes the open conversation, leaving the list. */
  private close(): void {
    this.session?.dispose()
    this.session = null
    this.partner = null
    this.transcript.reset()
    this.outbox.clear()
    this.newMessages.reset(null)
    if (!this.modals.isOpen) this.focusList()
  }

  /** The conversation's name, else its short address, safe to show. */
  private label(address: Address): string {
    return terminalText(displayName(address, this.state.names(), this.identity.address))
  }

  private submit(): void {
    const text = this.composer.text
    const input = classifyInput(text)
    if (input.type === 'empty') return
    if (input.type === 'command') {
      this.composer.clear()
      // Keep a mistyped command for fixing.
      if (!this.commands.run(input.line)) this.composer.setText(text)
      return
    }
    const session = this.session
    if (!session) { this.toast('Open a conversation first: /open ADDRESS', 'error'); return }
    this.composer.clear()
    // Sending clears the new-messages divider and earlier failures.
    this.newMessages.reset(null)
    this.outbox.clearFailed()
    const key = this.outbox.add(input.text, session.snapshot().now())
    this.renderMessages()
    session.send(input.text, this.ttl).then(message => {
      if (this.session === session) this.outbox.delivered(key, message)
    }, error => {
      // After quitting, the composer is gone and nobody sees a toast.
      if (this.stopped) return
      // Nothing typed is lost: a failed message goes back to an empty composer.
      const restored = !this.composer.text
      if (restored) this.composer.setText(text)
      if (this.session === session) this.outbox.failed(key, restored)
      this.toast(`Send failed: ${errorMessage(error, 'unknown error')}. It may still have arrived; check before resending.`, 'error')
    }).finally(() => this.renderMessages())
  }

  private render(): void {
    if (this.stopped) return
    this.renderStatus()
    this.renderHints()
    this.renderList()
    this.transcript.renderPane({
      partner: this.partner, snapshot: this.session?.snapshot() ?? null, attentive: this.attention.attentive,
      collapsed: this.layout.collapsed, name: this.partner && this.state.name(this.partner),
    })
    this.renderMessages()
  }

  private renderStatus(): void {
    if (this.stopped) return
    this.statusBar.render({ live: this.live, ttl: this.ttl, attentive: this.attention.attentive, now: Date.now() })
  }

  /** The keys of the open modal, else of whatever has focus. */
  private renderHints(): void {
    if (this.stopped) return
    const hints = this.modals.hints
      ?? (this.sidebar.focused ? LIST_HINTS : this.composer.focused ? COMPOSER_HINTS : UNFOCUSED_HINTS)
    this.hintBar.render(hints)
  }

  private renderList(): void {
    if (this.stopped) return
    const rows = this.conversations.map(conversation => ({
      ...conversation,
      name: this.state.name(conversation.address),
      badge: unreadBadge(this.unread.count(conversation.address, this.state.unreadAfter(conversation.address))),
    }))
    this.sidebar.render(rows, this.partner)
  }

  private renderMessages(): void {
    if (this.stopped || !this.session || !this.partner) return
    const snapshot = this.session.snapshot()
    const now = snapshot.now()
    const messages = this.outbox.merge(snapshot.messages, now)
    this.transcript.renderMessages(messages, this.label(this.partner), now, this.newMessages.first(messages, this.partner))
  }
}
