import { TextRenderable, dim, fg, t, type CliRenderer, type StyledText } from '@opentui/core'
import { shortAddress, type Address } from '../../src/shared/address'
import { terminalText } from '../../src/cli/terminal-text'
import type { LiveStatus } from './identity-session'
import { fitBar, type BarItem } from './bar'
import { lifetimeLabel } from './lifetime'
import { COLORS } from './theme'

export interface StatusState {
  live: LiveStatus
  ttl: number
  attentive: boolean
  /** Date.now() time, for the reconnect countdown. */
  now: number
}

/** After this many failed attempts in a row the connection shows as offline. */
export const OFFLINE_AFTER = 3

/** `prod`, `local`, or the host of any other server. */
export function serverLabel(origin: string): string {
  if (origin === 'https://hushhash.org') return 'prod'
  if (origin === 'http://localhost:3000') return 'local'
  return new URL(origin).host
}

/** The connection, with a countdown to the next attempt while it is down. */
export function connectionText(live: LiveStatus, now: number): StyledText {
  if (live.state === 'connected') return t`${fg(COLORS.you)('● connected')}`
  if (live.state === 'connecting') return t`${fg(COLORS.them)('◐ connecting…')}`
  const seconds = Math.max(0, Math.ceil((live.retryAt - now) / 1000))
  const when = seconds > 0 ? `in ${seconds}s` : 'now'
  return live.failures >= OFFLINE_AFTER
    ? t`${fg(COLORS.error)(`○ offline · retrying ${when}`)}`
    : t`${fg(COLORS.them)(`◐ reconnecting ${when}`)}`
}

/**
 * The top line: the connection, the server, the lifetime of new messages,
 * whether you are away, and your address. A narrow terminal drops the
 * least important first.
 */
export class StatusBar {
  readonly view: TextRenderable

  constructor(private readonly renderer: CliRenderer, private readonly address: Address, private readonly server: string) {
    this.view = new TextRenderable(renderer, { content: '', height: 1, flexShrink: 0, paddingX: 1 })
  }

  render({ live, ttl, attentive, now }: StatusState): void {
    const items: BarItem[] = [
      { text: t`${fg(COLORS.accent)('hushhash')}`, priority: 0 },
      { text: t`${shortAddress(this.address)} ${dim('(you)')}`, priority: 4 },
      { text: connectionText(live, now), priority: 0 },
    ]
    if (live.state === 'retrying') items.push({ text: t`${dim(terminalText(live.reason))}`, priority: 6 })
    items.push(
      { text: t`${dim(serverLabel(this.server))}`, priority: 5 },
      { text: t`${dim(`lifetime ${lifetimeLabel(ttl)}`)}`, priority: 2 },
    )
    if (!attentive) items.push({ text: t`${fg(COLORS.them)('away')}`, priority: 1 })
    this.view.content = fitBar(items, this.renderer.width - 2, t`${'  '}`)
  }
}
