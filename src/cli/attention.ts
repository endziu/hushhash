// Without focus reports, input is the only sign that someone is looking.
export const IDLE_MS = 5 * 60_000
// Push suppression lapses 45 s after the last report of an attentive stream.
const ATTENTION_HEARTBEAT_MS = 20_000
// Focus flips quickly when switching windows; report it once settled.
const ATTENTION_SETTLE_MS = 300

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
  /** Starting the TUI counts as input. */
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

export type SendAttention = (stream: string, attentive: boolean, sequence: number) => Promise<unknown>

/**
 * Tells the server whether a terminal's live stream is attentive, as a
 * browser window reports its focus. A stream is dialled with the attention it
 * starts with; each settled change since is sent, and an attentive stream is
 * refreshed before the server's attention timeout lets push through again.
 */
export class AttentionReporter {
  private stream: string | null = null
  private sequence = 0
  private reported: boolean | null = null
  private settle: ReturnType<typeof setTimeout> | undefined
  private heartbeat: ReturnType<typeof setInterval> | undefined
  private disposed = false

  constructor(private readonly send: SendAttention, private current = true) {}

  /** The attention to dial the next live stream with. */
  get attentive(): boolean {
    return this.current
  }

  /** The terminal gained or lost attention. */
  set(attentive: boolean): void {
    this.current = attentive
    clearTimeout(this.settle)
    this.settle = setTimeout(() => {
      if (this.current !== this.reported) this.report(this.current)
    }, ATTENTION_SETTLE_MS)
  }

  /** A live stream opened, dialled with `dialed` attention. */
  opened(stream: string, dialed: boolean): void {
    if (this.disposed) return
    this.stream = stream
    this.sequence = 0
    // The URL told the server; report only a change since dialing.
    this.reported = dialed
    this.heartbeat ??= setInterval(() => {
      if (this.current || this.current !== this.reported) this.report(this.current)
    }, ATTENTION_HEARTBEAT_MS)
    if (this.current !== dialed) this.report(this.current)
  }

  /** The live stream closed; nothing is reported until the next one opens. */
  closed(): void {
    this.stream = null
    this.reported = null
  }

  dispose(): void {
    this.disposed = true
    this.closed()
    clearTimeout(this.settle)
    clearInterval(this.heartbeat)
  }

  private report(attentive: boolean): void {
    const stream = this.stream
    if (!stream || this.disposed) return
    this.reported = attentive
    const sequence = ++this.sequence
    this.send(stream, attentive, sequence).catch(() => {
      // Unknown to the server now; the next change or heartbeat resends.
      if (this.stream === stream && this.reported === attentive) this.reported = null
    })
  }
}
