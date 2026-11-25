// Without focus reports, input is the only sign that someone is looking.
export const IDLE_MS = 5 * 60_000

/** Enables and disables terminal focus reports (`\x1b[I` on focus, `\x1b[O` on blur). */
export const FOCUS_REPORTING_ON = '\x1b[?1004h'
export const FOCUS_REPORTING_OFF = '\x1b[?1004l'

/**
 * Whether someone is looking at this terminal, as a browser window's focus
 * says so. Focus reports are trusted once the terminal sends one. Until then,
 * key presses, pastes and clicks stand in for focus, and attention lapses
 * after `idleMs` without them, so a terminal that never reports focus (tmux
 * without `focus-events on`, screen, a background pane) cannot hold
 * attention, and suppress push, forever.
 */
export class TerminalAttention {
  /** Starting the client counts as input. */
  attentive = true
  private reportsFocus = false
  private idle: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly changed: (attentive: boolean) => void, private readonly idleMs = IDLE_MS) {
    this.restartIdle()
  }

  focus(): void {
    this.reportsFocus = true
    clearTimeout(this.idle)
    this.set(true)
  }

  blur(): void {
    this.reportsFocus = true
    clearTimeout(this.idle)
    this.set(false)
  }

  input(): void {
    if (!this.reportsFocus) this.restartIdle()
    this.set(true)
  }

  dispose(): void {
    clearTimeout(this.idle)
  }

  private restartIdle(): void {
    clearTimeout(this.idle)
    this.idle = setTimeout(() => this.set(false), this.idleMs)
  }

  private set(attentive: boolean): void {
    if (this.attentive === attentive) return
    this.attentive = attentive
    this.changed(attentive)
  }
}
