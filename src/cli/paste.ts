/** Stands in for a line break in the one-line chat prompt; sending turns it back into one. */
export const LINE_BREAK = '↵'

/** Enables and disables bracketed paste: the terminal wraps pasted text in PASTE_START and PASTE_END. */
export const BRACKETED_PASTE_ON = '\x1b[?2004h'
export const BRACKETED_PASTE_OFF = '\x1b[?2004l'
const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'
const ALT_ENTER = '\x1b\r'

/**
 * Rewrites terminal input for a readline prompt so that a paste is one edit
 * instead of a series of Enters. A bracketed paste's line breaks, and
 * Alt+Enter, become LINE_BREAK; other control characters in a paste are
 * dropped, so pasted text cannot press keys. Input that may be the start of a
 * marker split across reads is held back until more arrives or flush().
 */
export class PasteFilter {
  private pasting = false
  private held = ''
  private afterCarriageReturn = false

  /** Whether input is held back, waiting for the rest of a possible marker. */
  get pending(): boolean {
    return this.held !== ''
  }

  /** Returns what readline should see for `chunk`. */
  write(chunk: string): string {
    let input = this.held + chunk
    this.held = ''
    let output = ''
    while (input) {
      const marker = this.pasting ? PASTE_END : PASTE_START
      const at = input.indexOf(marker)
      let text = at === -1 ? input : input.slice(0, at)
      if (at === -1) {
        const partial = partialMarker(text, marker)
        this.held = text.slice(text.length - partial)
        text = text.slice(0, text.length - partial)
      }
      output += this.pasting ? this.pasted(text) : this.typed(text)
      if (at === -1) break
      input = input.slice(at + marker.length)
      this.pasting = !this.pasting
      this.afterCarriageReturn = false
    }
    return output
  }

  /** Releases held input once no more has arrived: it was not a marker after all. */
  flush(): string {
    const held = this.held
    this.held = ''
    return this.pasting ? this.pasted(held) : this.typed(held)
  }

  private typed(text: string): string {
    return text.replaceAll(ALT_ENTER, LINE_BREAK)
  }

  private pasted(text: string): string {
    // A CRLF split across reads is still one line break.
    if (this.afterCarriageReturn && text.startsWith('\n')) {
      text = text.slice(1)
      this.afterCarriageReturn = false
    }
    if (text) this.afterCarriageReturn = text.endsWith('\r')
    // eslint-disable-next-line no-control-regex -- pasted control characters would act as key presses
    return text.replace(/\r\n?|\n/g, LINE_BREAK).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
  }
}

/** The length of the longest end of `text` that begins `marker` without completing it. */
function partialMarker(text: string, marker: string): number {
  for (let length = Math.min(text.length, marker.length - 1); length > 0; length--) {
    if (marker.startsWith(text.slice(-length))) return length
  }
  return 0
}
