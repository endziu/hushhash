import { checksumAddress, parseAddress, type Address } from '../../src/shared/address'
import { errorMessage } from '../../src/client/lib/errors'
import { terminalText } from '../../src/cli/terminal-text'
import { LIFETIME_CHOICES_TEXT, lifetimeLabel, parseLifetime } from './lifetime'

export const HELP = [
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

const CLEAR_CONFIRM_MS = 10_000

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
  /** The text of the message on screen, if any. */
  shown(): string | null
  show(text: string, error?: boolean): void
  dismiss(): void
  toggleLog(): void
  quit(): void
}

/** Runs slash commands against the app. */
export class Commands {
  // /clear asks to be typed again for the same conversation before it deletes anything.
  private clearPending: { session: CommandSession; until: number } | null = null

  constructor(private readonly host: CommandHost, private readonly now: () => number = Date.now) {}

  /** Runs a command line; false if there is no such command. */
  run(line: string): boolean {
    const host = this.host
    const [name, ...args] = line.split(/\s+/)
    const arg = args.join(' ')
    switch (name) {
      case '/open':
      case '/new': {
        const address = parseAddress(arg)
        if (!address) host.show('Usage: /open 0xADDRESS', true)
        else host.open(address)
        return true
      }
      case '/ttl': {
        if (!arg) { host.show(`Lifetime ${lifetimeLabel(host.ttl())}. Choose: ${LIFETIME_CHOICES_TEXT}`); return true }
        const seconds = parseLifetime(arg)
        if (seconds === null) { host.show(`Choose a lifetime: ${LIFETIME_CHOICES_TEXT}`, true); return true }
        host.setTtl(seconds)
        host.show(`New messages disappear ${lifetimeLabel(seconds)} after they are opened`)
        return true
      }
      case '/clear':
        this.clear()
        return true
      case '/retry': {
        const session = host.session()
        if (session?.snapshot().openingFailed) session.retryOpening()
        else session?.retry()
        host.dismiss()
        return true
      }
      case '/older':
        void host.session()?.fetchOlder()
        return true
      case '/address':
        host.show(`Your address: ${checksumAddress(host.address)}`)
        return true
      case '/log':
        host.toggleLog()
        return true
      case '/help':
        if (host.shown() === HELP) host.dismiss()
        else host.show(HELP)
        return true
      case '/quit':
      case '/exit':
        host.quit()
        return true
      default:
        host.show(`Unknown command ${terminalText(name ?? '')}. /help lists commands; //text sends text starting with /`, true)
        return false
    }
  }

  private clear(): void {
    const host = this.host
    const session = host.session()
    if (!session) { host.show('Open a conversation first', true); return }
    const now = this.now()
    if (this.clearPending?.session !== session || now > this.clearPending.until) {
      this.clearPending = { session, until: now + CLEAR_CONFIRM_MS }
      host.show('Type /clear again within 10 seconds to delete every message in this conversation for both of you', true)
      return
    }
    this.clearPending = null
    session.clear()
      .then(() => host.show('Conversation cleared for both of you'))
      .catch(error => host.show(`Clear failed: ${errorMessage(error, 'unknown error')}`, true))
  }
}
