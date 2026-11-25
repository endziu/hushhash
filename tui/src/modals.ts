import {
  BoxRenderable, InputRenderable, InputRenderableEvents, ScrollBoxRenderable, StyledText, TextRenderable,
  bg, fg, t, type CliRenderer, type KeyEvent, type Renderable,
} from '@opentui/core'
import type { Hint } from './hints'
import { COLORS, LAYERS } from './theme'

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
}

export interface PromptOptions {
  title: string
  label?: string
  value?: string
  placeholder?: string
  /** What Enter does, for the hint bar, such as "save". */
  action?: string
  /** A problem with `value` to show under the input, or null to accept it. */
  validate?: (value: string) => string | null
}

const DEFAULT_WIDTH = 64
// Borders and the padding either side of the body.
const FRAME_COLUMNS = 4
// The top and bottom borders.
const FRAME_ROWS = 2

/** What a modal is made of, as each kind builds it. */
interface ModalParts {
  frame: BoxRenderable
  /** Its keys, for the hint bar. */
  hints: readonly Hint[]
  onKey: (key: KeyEvent) => void
  /** Gets focus while the modal is open; nothing does if absent. */
  focus?: Renderable
  /** Undoes anything set up outside the frame. */
  dispose?: () => void
}

/** The modal on screen. */
interface MountedModal extends ModalParts {
  cancel: () => void
  /** What had focus before the modal opened, to give it back on close. */
  restore: Renderable | null
}

/** A key without Ctrl or Alt, so Alt+y does not confirm a deletion. */
function plain(key: KeyEvent): boolean {
  return !key.ctrl && !key.meta
}

/**
 * Dialogs drawn above the layout, one at a time. While one is open the app
 * passes it every key (`handleKey`), and nothing underneath has focus, so
 * neither the composer nor the list reacts. Esc or a click outside cancels.
 * Opening another cancels the one that is open.
 */
export class Modals {
  private readonly backdrop: BoxRenderable
  private current: MountedModal | null = null

  /** `onChange` runs after a modal opens or closes. */
  constructor(private readonly renderer: CliRenderer, parent: Renderable, private readonly onChange: () => void = () => {}) {
    this.backdrop = new BoxRenderable(renderer, {
      position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', zIndex: LAYERS.modal,
      justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.backdrop, visible: false,
      onMouseDown: event => {
        // Nothing in or under a modal takes focus from a click.
        event.preventDefault()
        if (event.target === this.backdrop && event.button === 0) this.close()
      },
    })
    parent.add(this.backdrop)
  }

  get isOpen(): boolean {
    return this.current !== null
  }

  /** The open modal's keys; null when none is open. */
  get hints(): readonly Hint[] | null {
    return this.current?.hints ?? null
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
      const frame = this.frame(title, width)
      // Capped to the screen, since flex does not shrink a height set after the first layout.
      const rows = () => Math.min(wrappedRows(body, this.innerWidth(width)), this.innerHeight())
      const scroll = new ScrollBoxRenderable(this.renderer, { height: rows(), flexShrink: 1, minHeight: 1 })
      const fit = () => { scroll.height = rows() }
      this.renderer.on('resize', fit)
      scroll.add(this.text(body))
      frame.add(scroll)
      return {
        frame,
        hints: [{ keys: '↑↓', action: 'scroll', priority: 1 }, { keys: 'Esc', action: 'close', priority: 0 }],
        dispose: () => this.renderer.off('resize', fit),
        onKey: key => {
          key.preventDefault()
          if (!plain(key)) return
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
  confirm({ title, body, action }: ConfirmOptions): Promise<boolean> {
    return this.present(false, finish => {
      const frame = this.frame(title)
      frame.add(this.text(body))
      const row = new BoxRenderable(this.renderer, { flexDirection: 'row', justifyContent: 'flex-end', gap: 2, marginTop: 1, flexShrink: 0 })
      const labels = ['Cancel', action]
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
        hints: [
          { keys: '←→', action: 'choose', priority: 1 },
          { keys: 'Enter', action: 'select', priority: 0 },
          { keys: 'y', action: action.toLowerCase(), priority: 2 },
          { keys: 'n/Esc', action: 'cancel', priority: 0 },
        ],
        onKey: key => {
          key.preventDefault()
          if (!plain(key)) return
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
      const frame = this.frame(title)
      if (label) frame.add(this.text(label, { marginBottom: 1 }))
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
        hints: [{ keys: 'Enter', action, priority: 0 }, { keys: 'Esc', action: 'cancel', priority: 0 }],
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

  private present<T>(cancelled: T, build: (finish: (value: T) => void) => ModalParts): Promise<T> {
    return new Promise(resolve => {
      let settled = false
      const finish = (value: T) => {
        if (settled) return
        settled = true
        this.unmount(parts.frame)
        resolve(value)
      }
      const parts = build(finish)
      this.mount({ ...parts, cancel: () => finish(cancelled), restore: null })
    })
  }

  private mount(modal: MountedModal): void {
    // Hand focus straight over from a modal being replaced, not back underneath first.
    const replaced = this.current
    if (replaced) {
      this.current = null
      modal.restore = replaced.restore
      this.dismantle(replaced)
      replaced.cancel()
    } else {
      modal.restore = this.renderer.currentFocusedRenderable
      modal.restore?.blur()
    }
    this.backdrop.add(modal.frame)
    this.backdrop.visible = true
    this.current = modal
    modal.focus?.focus()
    this.onChange()
  }

  private unmount(frame: BoxRenderable): void {
    const current = this.current
    if (current?.frame !== frame) return
    this.current = null
    this.dismantle(current)
    this.backdrop.visible = false
    if (current.restore && !current.restore.isDestroyed) current.restore.focus()
    this.onChange()
  }

  private dismantle(modal: MountedModal): void {
    modal.dispose?.()
    this.backdrop.remove(modal.frame)
    modal.frame.destroyRecursively()
  }

  private text(content: string | StyledText, options: { marginBottom?: number } = {}): TextRenderable {
    return new TextRenderable(this.renderer, { content, wrapMode: 'word', fg: COLORS.text, ...options })
  }

  private frame(title: string, width = DEFAULT_WIDTH): BoxRenderable {
    return new BoxRenderable(this.renderer, {
      width, maxWidth: '90%', maxHeight: '90%', flexDirection: 'column', paddingX: 1,
      border: true, borderStyle: 'rounded', borderColor: COLORS.accent, backgroundColor: COLORS.surface,
      title: ` ${title} `, titleColor: COLORS.accent,
    })
  }

  private innerHeight(): number {
    return Math.max(1, Math.floor(this.renderer.height * 0.9) - FRAME_ROWS)
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
