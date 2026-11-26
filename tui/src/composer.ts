import { BoxRenderable, StyledText, TextRenderable, TextareaRenderable, bg, bold, fg, t, type CliRenderer } from '@opentui/core'
import type { Completion } from './command-list'
import { fitText } from './sidebar'
import { joinLines } from './styled'
import { COLORS, LAYERS, highlightOnFocus, onFocusChange } from './theme'

/** The composer grows with its text up to this many lines, then scrolls. */
export const COMPOSER_MAX_LINES = 8
// The top and bottom borders.
const FRAME_ROWS = 2

/**
 * About how many rows `text` takes wrapped at `width` columns. Word wrapping
 * can take a row more than this; the composer then scrolls by that row.
 */
export function wrappedLines(text: string, width: number): number {
  const columns = Math.max(1, width)
  return text.split('\n').reduce((rows, line) => rows + Math.max(1, Math.ceil(Bun.stringWidth(line) / columns)), 0)
}

/** The command list shows at most this many commands, and scrolls. */
export const COMPLETION_ROWS = 8

/**
 * The message box. Enter calls `onSubmit`; Alt+Enter, Shift+Enter and Ctrl+J
 * add a line. `onChange` hears every change to the text. Above it, a list
 * of commands can show while one is being typed.
 */
export class Composer {
  readonly view: BoxRenderable
  private readonly input: TextareaRenderable
  private readonly paintFrame: () => void
  private readonly popup: BoxRenderable
  private readonly popupText: TextRenderable
  /** What the command list shows, to draw it again in a new palette. */
  private completions: { items: readonly Completion[]; selected: number } | null = null

  constructor(renderer: CliRenderer, onSubmit: () => void, onChange: () => void = () => {}) {
    this.view = new BoxRenderable(renderer, { height: 1 + FRAME_ROWS, flexShrink: 0, border: true, borderStyle: 'rounded' })
    // Drawn over the conversation, its bottom border on the composer's top one.
    this.popup = new BoxRenderable(renderer, {
      position: 'absolute', left: -1, right: -1, zIndex: LAYERS.popup, visible: false,
      border: true, borderStyle: 'rounded', title: ' Commands ',
    })
    this.popupText = new TextRenderable(renderer, { content: '', flexGrow: 1 })
    this.popup.add(this.popupText)
    this.view.add(this.popup)
    this.input = new TextareaRenderable(renderer, {
      flexGrow: 1, placeholder: 'Write a message · /help for commands', wrapMode: 'word',
      keyBindings: [
        { name: 'return', action: 'submit' },
        { name: 'return', shift: true, action: 'newline' },
        { name: 'return', meta: true, action: 'newline' },
      ],
      onSubmit,
      onContentChange: () => { this.fit(); onChange() },
    })
    this.view.add(this.input)
    this.paintFrame = highlightOnFocus(this.view, this.input)
    this.applyTheme()
  }

  /** Repaints with the current palette. */
  applyTheme(): void {
    this.input.placeholderColor = COLORS.muted
    this.input.textColor = COLORS.text
    this.input.focusedTextColor = COLORS.text
    this.input.cursorColor = COLORS.text
    this.view.titleColor = COLORS.muted
    this.popup.borderColor = this.popup.titleColor = COLORS.accent
    this.popup.backgroundColor = COLORS.surface
    this.paintFrame()
    if (this.completions) this.showCompletions(this.completions.items, this.completions.selected)
  }

  /** The border's title. */
  set title(title: string) {
    this.view.title = title
  }

  /** Lists `items` above the composer with `selected` highlighted; none hides the list. */
  showCompletions(items: readonly Completion[], selected: number): void {
    this.completions = items.length ? { items, selected } : null
    this.popup.visible = items.length > 0
    if (!items.length) return
    const rows = Math.min(items.length, COMPLETION_ROWS)
    const first = Math.max(0, Math.min(selected - rows + 1, items.length - rows))
    this.popup.height = rows + FRAME_ROWS
    // Its position is from inside the composer's border; it ends just above that border.
    this.popup.top = -(rows + FRAME_ROWS) - 1
    this.popupText.content = completionLines(items.slice(first, first + rows), selected - first, Math.max(1, this.view.width - FRAME_ROWS))
  }

  /** Grows or shrinks to the text's wrapped lines; for after typing or a resize. */
  fit(): void {
    const lines = Math.max(1, Math.min(COMPOSER_MAX_LINES, wrappedLines(this.input.plainText, this.input.width)))
    if (this.view.height !== lines + FRAME_ROWS) this.view.height = lines + FRAME_ROWS
  }

  get text(): string {
    return this.input.plainText
  }

  /** Runs `listener` whenever this gains or loses focus. */
  onFocusChange(listener: (focused: boolean) => void): void {
    onFocusChange(this.input, listener)
  }

  get focused(): boolean {
    return this.input.focused
  }

  focus(): void {
    this.input.focus()
  }

  clear(): void {
    this.input.clear()
  }

  /** Replaces the text, with the cursor after it. */
  setText(text: string): void {
    this.input.setText(text)
    this.input.gotoBufferEnd()
  }
}

/** The commands on screen, one a line: the name and what it does. */
function completionLines(items: readonly Completion[], selected: number, width: number): StyledText {
  const names = Math.max(...items.map(({ word }) => word.length + 1))
  const lines = items.map(({ command, word }, index) => {
    const name = ` /${word}`.padEnd(names + 3)
    const description = fitText(command.description, width - name.length)
    const pad = ' '.repeat(Math.max(0, width - name.length - Bun.stringWidth(description)))
    if (index !== selected) return t`${fg(COLORS.accent)(name)}${fg(COLORS.muted)(description)}${pad}`
    const on = bg(COLORS.selection)
    return t`${on(bold(fg(COLORS.accent)(name)))}${on(fg(COLORS.text)(description))}${on(pad)}`
  })
  return joinLines(lines)
}
