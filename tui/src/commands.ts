import { checksumAddress, parseAddress, type Address } from '../../src/shared/address'
import { errorMessage } from '../../src/client/lib/errors'
import { terminalText } from '../../src/cli/terminal-text'
import { HELP } from './help'
import { LIFETIME_CHOICES_TEXT, lifetimeLabel, parseLifetime } from './lifetime'
import type { ConfirmOptions, ModalOptions } from './modals'
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
  readonly address: Address
  /** The open conversation, or null before one is opened. */
  session(): CommandSession | null
  ttl(): number
  setTtl(seconds: number): void
  open(address: Address): void
  toast(text: string, kind?: ToastKind): void
  modal(options: ModalOptions): void
  confirm(options: ConfirmOptions): Promise<boolean>
  toggleLog(): void
  quit(): void
}

/** The Help modal, for /help, F1 and ? in the list. */
export const HELP_MODAL: ModalOptions = { title: 'Help', body: HELP, width: 84 }

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
        const address = parseAddress(arg)
        if (!address) host.toast('Usage: /open 0xADDRESS', 'error')
        else host.open(address)
        return true
      }
      case '/ttl': {
        if (!arg) { host.toast(`Lifetime ${lifetimeLabel(host.ttl())}. Choose: ${LIFETIME_CHOICES_TEXT}`); return true }
        const seconds = parseLifetime(arg)
        if (seconds === null) { host.toast(`Choose a lifetime: ${LIFETIME_CHOICES_TEXT}`, 'error'); return true }
        host.setTtl(seconds)
        host.toast(`New messages disappear ${lifetimeLabel(seconds)} after they are opened`, 'success')
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
      case '/address':
        host.modal({ title: 'Your address', body: `${checksumAddress(host.address)}\n\nShare it so people can message you.` })
        return true
      case '/log':
        host.toggleLog()
        return true
      case '/help':
        host.modal(HELP_MODAL)
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
