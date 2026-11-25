import { BoxRenderable, TextareaRenderable, type CliRenderer } from '@opentui/core'
import { COLORS, highlightOnFocus } from './theme'

/** The message box. Enter calls `onSubmit`; Alt+Enter, Shift+Enter and Ctrl+J add a line. */
export class Composer {
  readonly view: BoxRenderable
  private readonly input: TextareaRenderable

  constructor(renderer: CliRenderer, onSubmit: () => void) {
    this.view = new BoxRenderable(renderer, { height: 6, border: true, borderStyle: 'rounded', borderColor: COLORS.border })
    this.input = new TextareaRenderable(renderer, {
      flexGrow: 1, placeholder: 'Write a message · /help for commands', placeholderColor: COLORS.muted, wrapMode: 'word',
      keyBindings: [
        { name: 'return', action: 'submit' },
        { name: 'return', shift: true, action: 'newline' },
        { name: 'return', meta: true, action: 'newline' },
      ],
      onSubmit,
    })
    this.view.add(this.input)
    highlightOnFocus(this.view, this.input)
  }

  get text(): string {
    return this.input.plainText
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
