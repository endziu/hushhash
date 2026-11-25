import {
  BoxRenderable, InputRenderable, InputRenderableEvents, ScrollBoxRenderable, StyledText, TextRenderable,
  bg, fg, t, type CliRenderer, type KeyEvent, type Renderable,
} from '@opentui/core'
import { COLORS } from './theme'

export interface ModalOptions {
  title: string
  body: string | StyledText
  /** Columns, borders included; never more than 90% of the screen. */
  width?: number
}

export interface ConfirmOptions {
  title: string
  body: string
  /** The label of the destructive action, such as "Delete". */
  action: string
  cancel?: string
}

export interface PromptOptions {
  title: string
  label?: string
  value?: string
  placeholder?: string
  /** What Enter does, for the hint line, such as "save". */
  action?: string
  /** A problem with `value` to show under the input, or null to accept it. */
  validate?: (value: string) => string | null
}

const DEFAULT_WIDTH = 64
// Borders and the padding either side of the body.
const FRAME_COLUMNS = 4

interface Open {
  frame: BoxRenderable
  onKey: (key: KeyEvent) => void
  cancel: () => void
  /** What had focus before the modal opened, to give it back on close. */
  restore: Renderable | null
}

interface Built {
  frame: BoxRenderable
  onKey: (key: KeyEvent) => void
  focus?: Renderable
}

/**
 * Dialogs drawn above the layout, one at a time. While one is open the app
 * passes it every key (`handleKey`), and nothing underneath has focus, so
 * neither the composer nor the list reacts. Esc or a click outside cancels.
 * Opening another cancels the one that is open.
 */
export class Modals {
  private readonly backdrop: BoxRenderable
  private current: Open | null = null

  constructor(private readonly renderer: CliRenderer, parent: Renderable) {
    this.backdrop = new BoxRenderable(renderer, {
      position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', zIndex: 100,
      justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.backdrop, visible: false,
      onMouseDown: event => {
        if (event.target !== this.backdrop) return
        event.preventDefault()
        this.close()
      },
    })
    parent.add(this.backdrop)
  }

  get isOpen(): boolean {
    return this.current !== null
  }

  /** Gives `key` to the open modal; false when none is open. */
  handleKey(key: KeyEvent): boolean {
    if (!this.current) return false
    this.current.onKey(key)
    return true
  }

  /** Cancels the open modal, if any. */
  close(): void {
    this.current?.cancel()
  }

  /** Shows `body` until Esc, Enter or q. */
  show({ title, body, width = DEFAULT_WIDTH }: ModalOptions): Promise<void> {
    return this.present<void>(undefined, finish => {
      const frame = this.frame(title, '↑/↓ scroll · Esc close', width)
      const scroll = new ScrollBoxRenderable(this.renderer, {
        height: wrappedRows(body, this.innerWidth(width)), flexShrink: 1, minHeight: 1,
      })
      scroll.add(new TextRenderable(this.renderer, { content: body, wrapMode: 'word', fg: COLORS.text }))
      frame.add(scroll)
      return {
        frame,
        onKey: key => {
          key.preventDefault()
          if (key.name === 'escape' || key.name === 'return' || key.name === 'q') finish()
          else if (key.name === 'up') scroll.scrollBy(-1)
          else if (key.name === 'down') scroll.scrollBy(1)
          else if (key.name === 'pageup') scroll.scrollBy(-1, 'viewport')
          else if (key.name === 'pagedown') scroll.scrollBy(1, 'viewport')
        },
      }
    })
  }

  /**
   * Asks before a destructive action; true if it was chosen. Cancel is
   * selected first, so a stray Enter does nothing harmful.
   */
  confirm({ title, body, action, cancel = 'Cancel' }: ConfirmOptions): Promise<boolean> {
    return this.present(false, finish => {
      const frame = this.frame(title, '←/→ choose · Enter · y/n · Esc cancel')
      frame.add(new TextRenderable(this.renderer, { content: body, wrapMode: 'word', fg: COLORS.text }))
      const row = new BoxRenderable(this.renderer, { flexDirection: 'row', justifyContent: 'flex-end', gap: 2, marginTop: 1, flexShrink: 0 })
      const labels = [cancel, action]
      let selected = 0
      const buttons = labels.map((_, index) => new TextRenderable(this.renderer, {
        content: '',
        onMouseDown: event => {
          if (event.button !== 0) return
          event.preventDefault()
          finish(index === 1)
        },
      }))
      const paint = () => buttons.forEach((button, index) => {
        button.content = buttonText(labels[index]!, index === selected, index === 1)
      })
      paint()
      for (const button of buttons) row.add(button)
      frame.add(row)
      return {
        frame,
        onKey: key => {
          key.preventDefault()
          if (key.name === 'escape' || key.name === 'n') finish(false)
          else if (key.name === 'y') finish(true)
          else if (key.name === 'return') finish(selected === 1)
          else if (key.name === 'left' || key.name === 'right' || key.name === 'tab') { selected = 1 - selected; paint() }
        },
      }
    })
  }

  /** Asks for one line of text; null if cancelled. */
  prompt({ title, label, value = '', placeholder, action = 'save', validate }: PromptOptions): Promise<string | null> {
    return this.present<string | null>(null, finish => {
      const frame = this.frame(title, `Enter ${action} · Esc cancel`)
      if (label) frame.add(new TextRenderable(this.renderer, { content: label, wrapMode: 'word', fg: COLORS.text, marginBottom: 1 }))
      const input = new InputRenderable(this.renderer, {
        value, placeholder, width: '100%', flexShrink: 0,
        textColor: COLORS.text, focusedTextColor: COLORS.text, placeholderColor: COLORS.muted,
        backgroundColor: COLORS.selection, focusedBackgroundColor: COLORS.selection,
      })
      const problem = new TextRenderable(this.renderer, { content: '', fg: COLORS.error, wrapMode: 'word', flexShrink: 0 })
      input.on(InputRenderableEvents.INPUT, () => { problem.content = '' })
      input.on(InputRenderableEvents.ENTER, (text: string) => {
        const invalid = validate?.(text) ?? null
        if (invalid) problem.content = invalid
        else finish(text)
      })
      frame.add(input)
      frame.add(problem)
      return {
        frame,
        focus: input,
        // Everything but Esc reaches the focused input.
        onKey: key => {
          if (key.name !== 'escape') return
          key.preventDefault()
          finish(null)
        },
      }
    })
  }

  private present<T>(cancelled: T, build: (finish: (value: T) => void) => Built): Promise<T> {
    return new Promise(resolve => {
      let settled = false
      const finish = (value: T) => {
        if (settled) return
        settled = true
        this.unmount(built.frame)
        resolve(value)
      }
      const built = build(finish)
      this.mount({ frame: built.frame, onKey: built.onKey, cancel: () => finish(cancelled), restore: null }, built.focus)
    })
  }

  private mount(open: Open, focus: Renderable | undefined): void {
    this.close()
    open.restore = this.renderer.currentFocusedRenderable
    open.restore?.blur()
    this.backdrop.add(open.frame)
    this.backdrop.visible = true
    this.current = open
    focus?.focus()
  }

  private unmount(frame: BoxRenderable): void {
    const current = this.current
    if (current?.frame !== frame) return
    this.current = null
    this.backdrop.remove(frame)
    frame.destroyRecursively()
    this.backdrop.visible = false
    if (current.restore && !current.restore.isDestroyed) current.restore.focus()
  }

  private frame(title: string, hints: string, width = DEFAULT_WIDTH): BoxRenderable {
    return new BoxRenderable(this.renderer, {
      width, maxWidth: '90%', maxHeight: '90%', flexDirection: 'column', paddingX: 1,
      border: true, borderStyle: 'rounded', borderColor: COLORS.accent, backgroundColor: COLORS.surface,
      title: ` ${title} `, titleColor: COLORS.accent, bottomTitle: ` ${hints} `, bottomTitleAlignment: 'right',
    })
  }

  private innerWidth(width: number): number {
    return Math.max(1, Math.min(width, Math.floor(this.renderer.width * 0.9)) - FRAME_COLUMNS)
  }
}

/** Roughly how many rows `body` takes at `width` columns; the frame scrolls if it is more. */
function wrappedRows(body: string | StyledText, width: number): number {
  const text = typeof body === 'string' ? body : body.chunks.map(chunk => chunk.text).join('')
  return text.split('\n').reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length / width)), 0)
}

function buttonText(label: string, selected: boolean, destructive: boolean): StyledText {
  if (!selected) return t`${fg(COLORS.muted)(`[ ${label} ]`)}`
  return t`${bg(destructive ? COLORS.error : COLORS.accent)(fg(COLORS.onAccent)(`[ ${label} ]`))}`
}
