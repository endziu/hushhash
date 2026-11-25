import { TextRenderable, dim, fg, t, type CliRenderer } from '@opentui/core'
import { terminalText } from '../../src/cli/terminal-text'
import { lifetimeLabel } from './lifetime'
import { COLORS } from './theme'

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
