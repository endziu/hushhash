// Peer-controlled text must never reach the terminal as control sequences
// or disguise its direction. Newlines survive: messages can span lines.
export function safeText(value: string): string {
  // eslint-disable-next-line no-control-regex -- terminal escape sequences are untrusted input
  return value.replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f؜‎‏‪-‮⁦-⁩]/g, char => {
    if (char === '\t') return '  '
    return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
  })
}
