import { TextRenderable, fg, t, type CliRenderer } from '@opentui/core'
import { PRIORITY, fitBar, type Priority } from './bar'
import { COLORS, LAYERS } from './theme'

/** A key and what it does here. */
export interface Hint {
  keys: string
  action: string
  priority: Priority
}

export const COMPOSER_HINTS: readonly Hint[] = [
  { keys: 'Enter', action: 'send', priority: PRIORITY.essential },
  { keys: 'Alt+Enter', action: 'new line', priority: PRIORITY.normal },
  { keys: 'Tab/Esc', action: 'list', priority: PRIORITY.high },
  { keys: 'PgUp/PgDn', action: 'scroll', priority: PRIORITY.low },
  { keys: 'F1', action: 'help', priority: PRIORITY.essential },
  { keys: 'Ctrl+C', action: 'quit', priority: PRIORITY.lower },
]

export const LIST_HINTS: readonly Hint[] = [
  { keys: '↑↓', action: 'move', priority: PRIORITY.high },
  { keys: 'Enter', action: 'open', priority: PRIORITY.essential },
  { keys: 'Tab', action: 'composer', priority: PRIORITY.high },
  { keys: 'PgUp/PgDn', action: 'scroll', priority: PRIORITY.low },
  { keys: '?', action: 'help', priority: PRIORITY.essential },
  { keys: 'Ctrl+C', action: 'quit', priority: PRIORITY.lower },
]

/** When neither the list nor the composer has focus. */
export const UNFOCUSED_HINTS: readonly Hint[] = [
  { keys: 'Tab', action: 'composer', priority: PRIORITY.essential },
  { keys: 'F1', action: 'help', priority: PRIORITY.essential },
  { keys: 'Ctrl+C', action: 'quit', priority: PRIORITY.lower },
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
