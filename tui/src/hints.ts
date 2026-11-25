import { TextRenderable, fg, t, type CliRenderer } from '@opentui/core'
import { fitBar } from './bar'
import { COLORS, LAYERS } from './theme'

/** A key and what it does here. A lower `priority` is more important. */
export interface Hint {
  keys: string
  action: string
  priority: number
}

export const COMPOSER_HINTS: readonly Hint[] = [
  { keys: 'Enter', action: 'send', priority: 0 },
  { keys: 'Alt+Enter', action: 'new line', priority: 2 },
  { keys: 'Tab', action: 'list', priority: 1 },
  { keys: 'PgUp/PgDn', action: 'scroll', priority: 3 },
  { keys: 'F1', action: 'help', priority: 0 },
  { keys: 'Ctrl+C', action: 'quit', priority: 4 },
]

export const LIST_HINTS: readonly Hint[] = [
  { keys: '↑↓', action: 'move', priority: 1 },
  { keys: 'Enter', action: 'open', priority: 0 },
  { keys: 'Tab', action: 'composer', priority: 1 },
  { keys: 'PgUp/PgDn', action: 'scroll', priority: 3 },
  { keys: '?', action: 'help', priority: 0 },
  { keys: 'Ctrl+C', action: 'quit', priority: 4 },
]

/** When neither the list nor the composer has focus. */
export const UNFOCUSED_HINTS: readonly Hint[] = [
  { keys: 'Tab', action: 'composer', priority: 0 },
  { keys: 'F1', action: 'help', priority: 0 },
  { keys: 'Ctrl+C', action: 'quit', priority: 4 },
]

/**
 * The bottom line: the keys that work where focus is. A narrow terminal
 * drops the least important first. It stays above an open dialog's
 * backdrop, since it shows the dialog's keys.
 */
export class HintBar {
  readonly view: TextRenderable

  constructor(private readonly renderer: CliRenderer) {
    this.view = new TextRenderable(renderer, { content: '', height: 1, flexShrink: 0, paddingX: 1, zIndex: LAYERS.hints })
  }

  render(hints: readonly Hint[]): void {
    const items = hints.map(({ keys, action, priority }) => ({ text: t`${fg(COLORS.accent)(keys)} ${fg(COLORS.muted)(action)}`, priority }))
    this.view.content = fitBar(items, this.renderer.width - 2, t`${fg(COLORS.border)(' · ')}`)
  }
}
