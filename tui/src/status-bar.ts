import { TextRenderable, dim, fg, t, type CliRenderer } from '@opentui/core'
import { checksumAddress, type Address } from '../../src/shared/address'
import { terminalText } from '../../src/cli/terminal-text'
import { lifetimeLabel } from './lifetime'
import { COLORS } from './theme'

/** The top line: who you are and which server you are on. */
export class Header {
  readonly view: TextRenderable

  constructor(renderer: CliRenderer, address: Address, server: string) {
    this.view = new TextRenderable(renderer, {
      height: 1,
      content: t` ${fg(COLORS.accent)('hushhash')}  ${checksumAddress(address)} ${dim('(you)')}  ${dim(server)}`,
    })
  }
}

export interface FooterState {
  connected: boolean
  /** Why the live connection is down, while it is. */
  status: string
  ttl: number
  attentive: boolean
}

/** The bottom line: connection, lifetime of new messages and attention. */
export class Footer {
  readonly view: TextRenderable

  constructor(renderer: CliRenderer) {
    this.view = new TextRenderable(renderer, { content: '', height: 1 })
  }

  render({ connected, status, ttl, attentive }: FooterState): void {
    const connection = connected ? fg(COLORS.you)('● connected') : fg(COLORS.error)(`○ ${terminalText(status)}`)
    const focus = attentive ? '' : '  · away: new messages stay unopened'
    this.view.content = t` ${connection}  ${dim(`lifetime ${lifetimeLabel(ttl)}`)}${dim(focus)}  ${dim('· /help')}`
  }
}
