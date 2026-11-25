import type { CliRenderer, KeyEvent } from '@opentui/core'
import type { Address } from '../../src/shared/address'
import type { LiveEvent } from '../../src/shared/live-events'
import { ConversationSession } from '../../src/client/lib/conversation-session'
import { errorMessage } from '../../src/client/lib/errors'
import { IDLE_MS, TerminalAttention } from '../../src/cli/attention'
import type { ConnectionEpoch, IdentitySession } from './identity-session'
import { Commands, HELP_MODAL, classifyInput } from './commands'
import { Composer } from './composer'
import { mountLayout } from './layout'
import { Sidebar, type ConversationEntry } from './sidebar'
import { Footer } from './footer'
import { createHeader } from './header'
import { Modals } from './modals'
import { Toasts, type ToastKind } from './toasts'
import { Transcript } from './transcript'

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
  private readonly footer: Footer
  private readonly sidebar: Sidebar
  private readonly transcript: Transcript
  private readonly composer: Composer
  private readonly commands: Commands
  private readonly modals: Modals
  private readonly toasts: Toasts

  private conversations: ConversationEntry[] = []
  private readonly unread = new Set<Address>()
  private session: ConversationSession | null = null
  private partner: Address | null = null
  private epoch: ConnectionEpoch | null = null
  private readonly attention: TerminalAttention
  private connected = false
  private status = 'Connecting…'
  private ttl: number
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

    this.sidebar = new Sidebar(renderer, address => this.open(address))
    this.transcript = new Transcript(renderer, identity.address)
    this.composer = new Composer(renderer, () => this.submit())
    this.footer = new Footer(renderer)
    const root = mountLayout(renderer, {
      header: createHeader(renderer, identity.address, options.server), sidebar: this.sidebar.view, pane: this.transcript.view,
      composer: this.composer.view, footer: this.footer.view,
    }, () => this.attention.input())
    this.modals = new Modals(renderer, root)
    this.toasts = new Toasts(renderer, root)
    this.commands = new Commands({
      address: identity.address,
      session: () => this.session,
      ttl: () => this.ttl,
      setTtl: seconds => { this.ttl = seconds; this.render() },
      open: address => this.open(address),
      toast: (text, kind) => this.toast(text, kind),
      modal: options => void this.modals.show(options),
      confirm: options => this.modals.confirm(options),
      toggleLog: () => this.renderer.console.toggle(),
      quit: () => this.stop(),
    })

    renderer.keyInput.on('keypress', this.onKey)
    renderer.keyInput.on('paste', this.onPaste)
    renderer.on('focus', this.onFocus)
    renderer.on('blur', this.onBlur)
    // Signals destroy the renderer without asking; stop the same way as /quit.
    renderer.once('destroy', () => this.stop())
    this.tick = setInterval(() => this.renderMessages(), 1000)

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
        this.connected = epoch !== null
        this.session?.connectionChanged(epoch)
        if (epoch) void this.refreshConversations()
        this.render()
      },
      status: text => { this.status = text; this.render() },
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
    this.toasts.dispose()
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
    } else if (this.modals.handleKey(key)) {
      // An open modal takes every other key.
    } else if (key.name === 'f1' || (key.name === '?' && this.sidebar.focused)) {
      key.preventDefault()
      void this.modals.show(HELP_MODAL)
    } else if (key.name === 'tab' && !key.ctrl && !key.meta) {
      key.preventDefault()
      if (this.composer.focused) this.sidebar.focus()
      else this.composer.focus()
    } else if (key.name === 'escape' && this.composer.focused) {
      key.preventDefault()
      this.sidebar.focus()
    } else if (key.name === 'pageup') {
      key.preventDefault()
      if (this.transcript.atTop) void this.session?.fetchOlder()
      else this.transcript.scrollPage(-1)
    } else if (key.name === 'pagedown') {
      key.preventDefault()
      this.transcript.scrollPage(1)
    }
  }

  private toast(text: string, kind: ToastKind = 'info'): void {
    if (!this.stopped) this.toasts.show(text, kind)
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
      if (!this.identity.signal.aborted) this.toast(`Could not load conversations: ${errorMessage(error, 'unknown error')}`, 'error')
      return false
    }
  }

  open(partner: Address): void {
    if (partner === this.identity.address) { this.toast('That is your own address', 'error'); return }
    if (partner !== this.partner) {
      this.session?.dispose()
      this.transcript.reset()
      this.partner = partner
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
    this.composer.focus()
    this.render()
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
    session.send(input.text, this.ttl).catch(error => {
      // Nothing typed is lost: a failed message goes back to an empty composer.
      if (!this.composer.text) this.composer.setText(text)
      this.toast(`Send failed: ${errorMessage(error, 'unknown error')}. It may still have arrived; check before resending.`, 'error')
    })
  }

  private render(): void {
    if (this.stopped) return
    this.footer.render({ connected: this.connected, status: this.status, ttl: this.ttl, attentive: this.attention.attentive })
    this.renderList()
    this.transcript.renderPane({
      partner: this.partner, snapshot: this.session?.snapshot() ?? null, attentive: this.attention.attentive,
    })
    this.renderMessages()
  }

  private renderList(): void {
    this.sidebar.render(this.conversations, this.unread, this.partner)
  }

  private renderMessages(): void {
    if (this.stopped || !this.session) return
    this.transcript.renderMessages(this.session.snapshot())
  }
}
