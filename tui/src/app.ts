import type { CliRenderer, KeyEvent, PasteEvent, ThemeMode } from '@opentui/core'
import { checksumAddress, parseAddress, shortAddress, type Address } from '../../src/shared/address'
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
import { Sidebar, type ConversationEntry, type ListRow } from './sidebar'
import { COMPLETION_HINTS, COMPOSER_HINTS, FILTER_HINTS, HintBar, LIST_HINTS, UNFOCUSED_HINTS } from './hints'
import { StatusBar } from './status-bar'
import { Modals, type ChoiceItem } from './modals'
import { Toasts, type ToastKind } from './toasts'
import { Transcript } from './transcript'
import { NewMessages, newestAccepted } from './message-view'
import { Outbox } from './outbox'
import { resolveTheme, setTheme, themeName, type ThemeSetting } from './theme'
import { NAME_MAX_LENGTH, TuiState } from './state'
import { UnreadCounts, unreadBadge } from './unread'
import { shareContent } from './share'
import { keyContent } from './key-backup'
import { avatarGrid, avatarRows, canDrawAvatars } from './avatar'
import { conversationUrl } from '../../src/client/lib/address-links'
import { MESSAGE_LIFETIMES } from '../../src/client/lib/message-lifetime'
import { completeCommands, completedText, type Completion } from './command-list'
import { filterConversations, matchConversations } from './switcher'
import { lifetimeLabel, lifetimeNotice } from './lifetime'
import { Notifier, terminalTitle, totalUnread } from './notify'

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
  /** Where the identity file is, for the Key panel. */
  identityPath?: string
  /** Rings the terminal's bell, where it has no desktop notifications; default: writes BEL to stdout. */
  bell?: () => void
}

// OpenTUI has no bell. A lone BEL between its writes rings and draws nothing.
const ringBell = () => { process.stdout.write('\x07') }

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
  /** The conversations the list shows, in its order, for Alt+1…9. */
  private listed: Address[] = []
  /** What the list is filtered by; null when it is not. */
  private listFilter: string | null = null
  /** The commands listed above the composer, and the one chosen. */
  private completions: Completion[] = []
  private completionIndex = 0
  /** The text the command list was made for. */
  private completionsFor = ''
  /** What the composer held when Esc hid the command list; it stays hidden while that is typed on. */
  private completionDismissed: string | null = null
  private readonly state: TuiState
  private readonly unread = new UnreadCounts()
  /** Conversations whose unread count is being fetched. */
  private readonly counting = new Set<Address>()
  /** The newest message on screen when you switched away from each conversation, if any. */
  private readonly lastLooked = new Map<Address, number | null>()
  /** Hides the key in the open Key panel, if it is open. */
  private hideKey: (() => void) | null = null
  private session: ConversationSession | null = null
  private partner: Address | null = null
  private readonly outbox: Outbox
  private readonly notifier: Notifier
  /** The terminal title set last; null before one is. */
  private title: string | null = null
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
    this.notifier = new Notifier({
      notify: (title, message) => renderer.triggerNotification(message, title),
      bell: options.bell ?? ringBell,
    })
    this.attention = new TerminalAttention(attentive => this.attentionChanged(attentive), options.idleMs ?? IDLE_MS)
    // Like a browser window's focus: only an attentive terminal suppresses push.
    identity.setAttention(this.attention.attentive)

    this.sidebar = new Sidebar(renderer, address => this.open(address))
    this.transcript = new Transcript(renderer, identity.address)
    this.composer = new Composer(renderer, () => this.submit(), () => this.composerChanged())
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
    this.composer.onFocusChange(focused => { if (focused) this.showList(false); this.renderCompletions(); this.renderHints() })
    this.sidebar.onFocusChange(focused => {
      if (focused) this.showList(true)
      // A filter lasts while you are in the list.
      else if (this.listFilter !== null) this.setListFilter(null)
      this.renderHints()
    })
    this.toasts = new Toasts(renderer, root)
    this.commands = new Commands({
      session: () => this.session,
      ttl: () => this.ttl,
      setTtl: seconds => { this.ttl = seconds; this.render() },
      pickLifetime: () => void this.pickLifetime(),
      theme: () => this.themeSetting,
      setTheme: setting => this.setThemeSetting(setting),
      notifications: () => this.state.notifications(),
      setNotifications: on => this.state.setNotifications(on),
      partner: () => this.partner,
      open: address => this.open(address),
      rename: (address, name) => this.rename(address, name),
      remove: address => this.confirmRemove(address),
      toast: (text, kind) => this.toast(text, kind),
      share: () => this.share(),
      showKey: () => this.showKey(),
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
  private readonly onPaste = (event: PasteEvent) => {
    this.attention.input()
    this.modals.handlePaste(event)
  }
  private readonly onResize = () => {
    this.layout.fitToTerminal()
    this.composer.fit()
    this.render()
    this.renderCompletions()
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
    if (!attentive) {
      this.newMessages.away(this.newestShown())
      // Whoever is at the screen now may not be you.
      this.hideKey?.()
    }
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
    } else if (this.completionKey(key) || this.filterKey(key)) {
      // The command list or the list's filter took it.
    } else if (key.ctrl && !key.meta && key.name === 'k') {
      key.preventDefault()
      void this.switchConversation()
    } else if (key.ctrl && !key.meta && key.name === 't') {
      key.preventDefault()
      void this.pickLifetime()
    } else if (key.meta && !key.ctrl && /^[1-9]$/.test(key.name)) {
      key.preventDefault()
      const address = this.listed[Number(key.name) - 1]
      if (address) this.open(address)
    } else if (this.sidebar.focused && !key.ctrl && !key.meta && key.name === '/') {
      key.preventDefault()
      this.setListFilter('')
    } else if (key.name === 'f1' || (key.name === '?' && this.sidebar.focused)) {
      key.preventDefault()
      void this.modals.show(HELP_MODAL)
    } else if (this.sidebar.focused && !key.ctrl && !key.meta && key.name === 's') {
      key.preventDefault()
      this.share()
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

  /** Moves through, completes, runs or dismisses the command list; false if the key is not for it. */
  private completionKey(key: KeyEvent): boolean {
    // The composer reports changes late, and a key can come first.
    if (this.composer.focused && this.composer.text !== this.completionsFor) this.composerChanged()
    const completion = this.completing() ? this.completions[this.completionIndex] : undefined
    if (!completion || key.ctrl || key.meta || key.shift) return false
    if (key.name === 'up' || key.name === 'down') {
      const count = this.completions.length
      this.completionIndex = (this.completionIndex + (key.name === 'up' ? -1 : 1) + count) % count
      this.renderCompletions()
    } else if (key.name === 'tab') {
      this.composer.setText(completedText(completion))
    } else if (key.name === 'return') {
      // A command that needs more waits for it, unless typed in full; any other runs.
      if (completion.command.needsMore && this.composer.text !== `/${completion.word}`) this.composer.setText(completedText(completion))
      else { this.composer.setText(`/${completion.word}`); this.submit() }
    } else if (key.name === 'escape') {
      this.completionDismissed = this.composer.text
      this.composerChanged(true)
    } else {
      return false
    }
    key.preventDefault()
    return true
  }

  /** The command list is on screen. */
  private completing(): boolean {
    return this.composer.focused && this.completions.length > 0
  }

  /** Lists the commands that complete the composer's text, unless that is what they were listed for. */
  private composerChanged(force = false): void {
    const text = this.composer.text
    if (!force && text === this.completionsFor) return
    // Changes can arrive together, so an emptied composer may never be seen.
    if (this.completionDismissed !== null && !text.startsWith(this.completionDismissed)) this.completionDismissed = null
    this.completions = this.completionDismissed === null ? completeCommands(text) : []
    this.completionsFor = text
    this.completionIndex = 0
    this.renderCompletions()
    this.renderHints()
  }

  private renderCompletions(): void {
    if (this.stopped) return
    this.composer.showCompletions(this.composer.focused ? this.completions : [], this.completionIndex)
  }

  /** Types into or clears the list's filter; false if the key is not for it. */
  private filterKey(key: KeyEvent): boolean {
    const filter = this.listFilter
    if (filter === null || !this.sidebar.focused || key.ctrl || key.meta) return false
    // ↑↓ and Enter reach the list.
    if (key.name === 'escape') this.setListFilter(null)
    // Rubbing out the last character ends the filter.
    else if (key.name === 'backspace') this.setListFilter(filter ? [...filter].slice(0, -1).join('') : null)
    else if ([...key.sequence].length === 1 && !/\p{Cc}/u.test(key.sequence)) this.setListFilter(filter + key.sequence)
    else return false
    key.preventDefault()
    return true
  }

  private setListFilter(query: string | null): void {
    this.listFilter = query
    this.renderList()
    if (query !== null) this.sidebar.highlightFirst()
    this.renderHints()
  }

  /** The quick switcher: conversations by name or address, or a new one for an address typed in full. */
  private async switchConversation(): Promise<void> {
    const address = await this.modals.choose<Address>({
      title: 'Switch conversation',
      width: 76,
      filter: 'Name or address',
      action: 'open',
      empty: 'No conversation matches. Type a whole 0x address to start one.',
      items: query => this.switcherItems(query),
    })
    if (address && !this.stopped) this.open(address)
  }

  private switcherItems(query: string): ChoiceItem<Address>[] {
    const rows = this.listRows()
    const items: ChoiceItem<Address>[] = matchConversations(query, rows).map(row => ({
      label: row.name === null ? checksumAddress(row.address) : terminalText(row.name),
      detail: [row.name === null ? null : shortAddress(row.address), row.badge && `${row.badge} unread`].filter(Boolean).join(' · '),
      marked: row.address === this.partner,
      value: row.address,
    }))
    const typed = parseAddress(query.trim())
    if (typed && typed !== this.identity.address && !rows.some(row => row.address === typed)) {
      items.unshift({ label: `Start a conversation with ${checksumAddress(typed)}`, value: typed })
    }
    return items
  }

  /** Lists the lifetimes, the one in use marked, and switches to the one picked. */
  private async pickLifetime(): Promise<void> {
    const seconds = await this.modals.choose<number>({
      title: 'Message lifetime',
      width: 52,
      label: 'How long new messages stay after they are opened. Unopened, they wait 24h.',
      action: 'choose',
      initial: MESSAGE_LIFETIMES.findIndex(lifetime => lifetime.seconds === this.ttl),
      items: () => MESSAGE_LIFETIMES.map(({ seconds, label }) => ({
        label, value: seconds, marked: seconds === this.ttl, detail: seconds === this.ttl ? 'in use' : undefined,
      })),
    })
    if (seconds === null || this.stopped) return
    this.ttl = seconds
    this.toast(lifetimeNotice(seconds), 'success')
    this.render()
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

  /** Copies `text` to the clipboard through the terminal (OSC 52), saying whether it could. */
  private copy(text: string, what: string): void {
    if (this.renderer.copyToClipboardOSC52(text)) this.toast(`${what} copied`, 'success')
    else this.toast(`This terminal cannot copy (it lacks OSC 52); select the ${what.toLowerCase()} instead`, 'error')
  }

  /** Your avatar's rows, when the terminal can draw it. */
  private ownAvatar() {
    return canDrawAvatars(this.renderer.capabilities) ? avatarRows(avatarGrid(this.identity.address, themeName())) : null
  }

  /** The Share panel: your address and conversation link, and a QR code of the link. */
  private share(): void {
    const address = this.identity.address
    const link = conversationUrl(address, this.options.server)
    this.modals.panel({
      title: 'Share',
      width: 84,
      content: space => shareContent({ address, link }, space, { columns: this.renderer.width, rows: this.renderer.height }),
      keys: [
        { key: 'c', action: 'copy address', run: () => this.copy(checksumAddress(address), 'Address') },
        { key: 'l', action: 'copy link', run: () => this.copy(link, 'Link') },
      ],
    })
  }

  /**
   * The Key panel: your key, hidden until v shows it. It hides again when
   * the panel closes or you look away.
   */
  private showKey(): void {
    const { address, privateKey } = this.identity.identity
    let revealed = false
    const panel = this.modals.panel({
      title: 'Your key',
      width: 80,
      content: () => keyContent({ address, privateKey, path: this.options.identityPath ?? null, revealed, avatar: this.ownAvatar() }),
      keys: [
        { key: 'v', action: 'show or hide', run: () => { revealed = !revealed; panel.refresh() } },
        { key: 'c', action: 'copy key', run: () => this.copy(privateKey, 'Private key') },
      ],
      onClose: () => {
        revealed = false
        if (this.hideKey === hide) this.hideKey = null
      },
    })
    const hide = () => { if (revealed) { revealed = false; panel.refresh() } }
    this.hideKey = hide
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
    // Away, the desktop hears of it; at the screen, you see it.
    if (sender !== this.identity.address && !this.attention.attentive && this.state.notifications()) this.notifier.arrived()
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
    this.composer.title = ` Message · disappears ${lifetimeLabel(this.ttl)} after it is opened `
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
      ?? (this.completing() ? COMPLETION_HINTS
        : this.sidebar.focused ? (this.listFilter === null ? LIST_HINTS : FILTER_HINTS)
          : this.composer.focused ? COMPOSER_HINTS : UNFOCUSED_HINTS)
    this.hintBar.render(hints)
  }

  /** Every listed conversation, as the list shows it. */
  private listRows(): ListRow[] {
    return this.conversations.map(conversation => ({
      ...conversation,
      name: this.state.name(conversation.address),
      badge: unreadBadge(this.unread.count(conversation.address, this.state.unreadAfter(conversation.address))),
    }))
  }

  private renderList(): void {
    if (this.stopped) return
    const rows = this.listFilter === null ? this.listRows() : filterConversations(this.listFilter, this.listRows())
    this.listed = rows.map(row => row.address)
    this.sidebar.showFilter(this.listFilter, rows.length)
    this.sidebar.render(rows, this.partner)
    this.renderTitle()
  }

  /** The terminal title: everything unread, whatever the filter. OpenTUI clears it on exit. */
  private renderTitle(): void {
    const total = totalUnread(this.conversations.map(({ address }) => this.unread.count(address, this.state.unreadAfter(address))))
    const title = terminalTitle(total)
    if (title === this.title) return
    try {
      this.renderer.setTerminalTitle(title)
      this.title = title
    } catch {
      // A terminal not set up yet, such as a test's, takes none; the next change tries again.
    }
  }

  private renderMessages(): void {
    if (this.stopped || !this.session || !this.partner) return
    const snapshot = this.session.snapshot()
    const now = snapshot.now()
    const messages = this.outbox.merge(snapshot.messages, now)
    this.transcript.renderMessages(messages, this.label(this.partner), now, this.newMessages.first(messages, this.partner))
  }
}
