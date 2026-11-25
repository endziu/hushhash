// C0 and C1 controls, the Arabic letter mark, LRM/RLM, and the bidi embeddings, overrides and isolates.
// eslint-disable-next-line no-control-regex -- terminal escape sequences are untrusted input
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g

/**
 * Peer-controlled text made safe to print: it can never send terminal
 * commands or disguise its direction. A newline becomes a visible ↵ unless
 * `newlines` keeps it, for output that lays out multi-line messages itself.
 */
export function terminalText(value: string, { newlines = false } = {}): string {
  return value.replace(UNSAFE, char => {
    if (char === '\n') return newlines ? '\n' : ' ↵ '
    if (char === '\t') return '  '
    return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
  })
}
