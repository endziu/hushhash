import { BoxRenderable, TextareaRenderable, type CliRenderer } from '@opentui/core'
import { COLORS, highlightOnFocus, onFocusChange } from './theme'

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

/** The message box. Enter calls `onSubmit`; Alt+Enter, Shift+Enter and Ctrl+J add a line. */
export class Composer {
  readonly view: BoxRenderable
  private readonly input: TextareaRenderable
  private readonly paintFrame: () => void

  constructor(renderer: CliRenderer, onSubmit: () => void) {
    this.view = new BoxRenderable(renderer, { height: 1 + FRAME_ROWS, flexShrink: 0, border: true, borderStyle: 'rounded' })
    this.input = new TextareaRenderable(renderer, {
      flexGrow: 1, placeholder: 'Write a message · /help for commands', wrapMode: 'word',
      keyBindings: [
        { name: 'return', action: 'submit' },
        { name: 'return', shift: true, action: 'newline' },
        { name: 'return', meta: true, action: 'newline' },
      ],
      onSubmit,
      onContentChange: () => this.fit(),
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
    this.paintFrame()
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

  setText(text: string): void {
    this.input.setText(text)
  }
}
