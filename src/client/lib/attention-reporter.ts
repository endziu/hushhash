// Push suppression lapses 45 s after the last report of an attentive stream.
const ATTENTION_HEARTBEAT_MS = 20_000
// Focus flips quickly when switching windows, constantly on focus-follows-pointer
// desktops; report it once settled.
const ATTENTION_SETTLE_MS = 300

export type SendAttention = (stream: string, attentive: boolean, sequence: number) => Promise<unknown>

/**
 * Tells the server whether a live stream is attentive: whether someone is
 * looking at the browser window or terminal that holds it, so that push
 * notifications are held back. A stream is dialled with the attention it
 * starts with; each settled change since is sent, and an attentive stream is
 * refreshed before the server's attention timeout lets push through again.
 * Framework-free, so the browser, the CLI and the TUI share it.
 */
export class AttentionReporter {
  private stream: string | null = null
  private sequence = 0
  private reported: boolean | null = null
  private settle: ReturnType<typeof setTimeout> | undefined
  private heartbeat: ReturnType<typeof setInterval> | undefined
  private disposed = false

  /** `read` says whether someone is looking now; it is asked again at each report. */
  constructor(private readonly send: SendAttention, private readonly read: () => boolean) {}

  /** Attention changed, or may have; the settled value is reported. */
  changed(): void {
    clearTimeout(this.settle)
    this.settle = setTimeout(() => {
      const attentive = this.read()
      if (attentive !== this.reported) this.report(attentive)
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
      const attentive = this.read()
      if (attentive || attentive !== this.reported) this.report(attentive)
    }, ATTENTION_HEARTBEAT_MS)
    // Attention may have changed while dialing.
    const attentive = this.read()
    if (attentive !== dialed) this.report(attentive)
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
