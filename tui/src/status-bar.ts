import { StyledText, TextRenderable, dim, fg, t, type CliRenderer } from '@opentui/core'
import { shortAddress, type Address } from '../../src/shared/address'
import { serverName } from '../../src/cli/client'
import { terminalText } from '../../src/cli/terminal-text'
import type { LiveStatus } from './identity-session'
import { PRIORITY, fitBar, type BarItem } from './bar'
import { lifetimeLabel } from './lifetime'
import { avatarGrid, avatarLine, canDrawAvatars } from './avatar'
import { COLORS, themeName } from './theme'

export interface StatusState {
  live: LiveStatus
  ttl: number
  attentive: boolean
  /** Date.now() time, for the reconnect countdown. */
  now: number
}

/** After this many failed attempts in a row the connection shows as offline. */
export const OFFLINE_AFTER = 3

/** The connection, with a countdown to the next attempt while it is down. */
export function connectionText(live: LiveStatus, now: number): StyledText {
  if (live.state === 'connected') return t`${fg(COLORS.ok)('● connected')}`
  if (live.state === 'connecting') return t`${fg(COLORS.warning)('◐ connecting…')}`
  const seconds = Math.max(0, Math.ceil((live.retryAt - now) / 1000))
  // Once the countdown is over, the attempt is under way.
  const when = seconds > 0 ? ` in ${seconds}s` : '…'
  return live.failures >= OFFLINE_AFTER
    ? t`${fg(COLORS.error)(`○ offline · retrying${when}`)}`
    : t`${fg(COLORS.warning)(`◐ reconnecting${when}`)}`
}

/**
 * The top line: the connection, the server, the lifetime of new messages,
 * whether you are away, and your avatar and address. A narrow terminal drops the
 * least important first.
 */
export class StatusBar {
  readonly view: TextRenderable

  constructor(private readonly renderer: CliRenderer, private readonly address: Address, private readonly server: string) {
    this.view = new TextRenderable(renderer, { content: '', height: 1, flexShrink: 0, paddingX: 1 })
  }

  render({ live, ttl, attentive, now }: StatusState): void {
    const items: BarItem[] = [
      { text: t`${fg(COLORS.accent)('hushhash')}`, priority: PRIORITY.essential },
      { text: this.identityText(), priority: PRIORITY.low },
      { text: connectionText(live, now), priority: PRIORITY.essential },
    ]
    if (live.state === 'retrying') items.push({ text: t`${dim(terminalText(live.reason))}`, priority: PRIORITY.lowest })
    items.push(
      { text: t`${dim(serverName(this.server))}`, priority: PRIORITY.lower },
      { text: t`${dim(`lifetime ${lifetimeLabel(ttl)}`)}`, priority: PRIORITY.normal },
    )
    if (!attentive) items.push({ text: t`${fg(COLORS.warning)('away')}`, priority: PRIORITY.high })
    this.view.content = fitBar(items, this.renderer.width - 2, t`${'  '}`)
  }

  /** Your avatar, where the terminal can draw it, and short address. */
  private identityText(): StyledText {
    const text = t`${shortAddress(this.address)} ${dim('(you)')}`
    if (!canDrawAvatars(this.renderer.capabilities)) return text
    return new StyledText([...avatarLine(avatarGrid(this.address, themeName())).chunks, ...t` `.chunks, ...text.chunks])
  }
}
