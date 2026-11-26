import { parseAddress, type Address } from '../../src/shared/address'
import { errorMessage } from '../../src/client/lib/errors'
import { terminalText } from '../../src/cli/terminal-text'
import { HELP_MODAL } from './help'
import { LIFETIME_CHOICES_TEXT, lifetimeNotice, parseLifetime } from './lifetime'
import type { ConfirmOptions, ModalOptions } from './modals'
import { THEME_SETTINGS, parseThemeSetting, type ThemeSetting } from './theme'
import type { ToastKind } from './toasts'

export type ComposerInput =
  | { type: 'empty' }
  | { type: 'command'; line: string }
  | { type: 'message'; text: string }

/**
 * What submitting `text` from the composer means. Commands and the // escape
 * are one line; pasted text that merely starts with / is a message.
 */
export function classifyInput(text: string): ComposerInput {
  if (!text.trim()) return { type: 'empty' }
  const oneLine = !text.trim().includes('\n')
  if (oneLine && text.startsWith('/') && !text.startsWith('//')) return { type: 'command', line: text.trim() }
  return { type: 'message', text: oneLine && text.startsWith('//') ? text.slice(1) : text }
}

/** The parts of the open conversation that commands act on. */
export interface CommandSession {
  snapshot(): { openingFailed: boolean }
  retry(): void
  retryOpening(): void
  fetchOlder(): Promise<void>
  clear(): Promise<unknown>
}

/** What commands can read and change in the app. */
export interface CommandHost {
  /** The open conversation, or null before one is opened. */
  session(): CommandSession | null
  ttl(): number
  setTtl(seconds: number): void
  /** Lists the lifetimes to pick one from. */
  pickLifetime(): void
  theme(): ThemeSetting
  setTheme(setting: ThemeSetting): void
  /** The open conversation's partner, or null. */
  partner(): Address | null
  open(address: Address): void
  /** Names a conversation; an empty name removes it. */
  rename(address: Address, name: string): void
  /** Asks, then removes a conversation from this device's list. */
  remove(address: Address): Promise<void>
  toast(text: string, kind?: ToastKind): void
  /** Shows your address, conversation link and their QR code. */
  share(): void
  /** Shows your key, hidden until asked. */
  showKey(): void
  modal(options: ModalOptions): Promise<void>
  confirm(options: ConfirmOptions): Promise<boolean>
  toggleLog(): void
  quit(): void
}

/** Runs slash commands against the app. */
export class Commands {
  constructor(private readonly host: CommandHost) {}

  /** Runs a command line; false if there is no such command. */
  run(line: string): boolean {
    const host = this.host
    const [name, ...args] = line.split(/\s+/)
    const arg = args.join(' ')
    switch (name) {
      case '/open':
      case '/new': {
        const [first, ...rest] = args
        const address = parseAddress(first)
        if (!address) { host.toast('Usage: /open 0xADDRESS [NAME]', 'error'); return true }
        host.open(address)
        if (rest.length && host.partner() === address) host.rename(address, rest.join(' '))
        return true
      }
      case '/name': {
        const partner = host.partner()
        if (!partner) host.toast('Open a conversation first', 'error')
        else host.rename(partner, arg)
        return true
      }
      case '/remove': {
        const partner = host.partner()
        if (!partner) host.toast('Open a conversation first', 'error')
        else void host.remove(partner)
        return true
      }
      case '/ttl': {
        if (!arg) { host.pickLifetime(); return true }
        const seconds = parseLifetime(arg)
        if (seconds === null) { host.toast(`Choose a lifetime: ${LIFETIME_CHOICES_TEXT}`, 'error'); return true }
        host.setTtl(seconds)
        host.toast(lifetimeNotice(seconds), 'success')
        return true
      }
      case '/theme': {
        const choices = THEME_SETTINGS.join(', ')
        if (!arg) { host.toast(`Theme ${host.theme()}. Choose: ${choices}`); return true }
        const setting = parseThemeSetting(arg)
        if (!setting) { host.toast(`Choose a theme: ${choices}`, 'error'); return true }
        host.setTheme(setting)
        host.toast(setting === 'system' ? 'Theme follows the terminal' : `Theme ${setting}`, 'success')
        return true
      }
      case '/clear':
        void this.clear()
        return true
      case '/retry': {
        const session = host.session()
        if (session?.snapshot().openingFailed) session.retryOpening()
        else session?.retry()
        return true
      }
      case '/older':
        void host.session()?.fetchOlder()
        return true
      case '/share':
      case '/address':
        host.share()
        return true
      case '/key':
        host.showKey()
        return true
      case '/log':
        host.toggleLog()
        return true
      case '/help':
        void host.modal(HELP_MODAL)
        return true
      case '/quit':
      case '/exit':
        host.quit()
        return true
      default:
        host.toast(`Unknown command ${terminalText(name ?? '')}. /help lists commands; //text sends text starting with /`, 'error')
        return false
    }
  }

  private async clear(): Promise<void> {
    const host = this.host
    const session = host.session()
    if (!session) { host.toast('Open a conversation first', 'error'); return }
    const confirmed = await host.confirm({
      title: 'Clear conversation',
      body: 'Delete every message in this conversation, for both of you? This cannot be undone.',
      action: 'Delete',
    })
    // Another conversation may have opened meanwhile.
    if (!confirmed || host.session() !== session) return
    try {
      await session.clear()
      host.toast('Conversation cleared for both of you', 'success')
    } catch (error) {
      host.toast(`Clear failed: ${errorMessage(error, 'unknown error')}`, 'error')
    }
  }
}
