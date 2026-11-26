import type { Address } from '../../src/shared/address'

/** What a conversation is found by: its address, and its name if it has one. */
export interface Searchable {
  address: Address
  name: string | null
}

/** Each of `query`'s characters appears in `text`, in order. */
function inOrder(query: string, text: string): boolean {
  let at = 0
  for (const char of query) {
    at = text.indexOf(char, at)
    if (at < 0) return false
    at += char.length
  }
  return true
}

/**
 * How well `query` finds `entry`, lower being better, or null when it does
 * not. Case does not matter. A name matches from its start, from a word's
 * start, anywhere, or by its letters in order; an address matches from its
 * start, with or without 0x, or anywhere without it, such as its last
 * characters. Letters in order would make any address match any hex.
 */
export function matchScore(query: string, { address, name }: Searchable): number | null {
  const typed = query.trim().toLowerCase()
  if (!typed) return 0
  const label = name?.toLowerCase() ?? ''
  const hex = address.slice(2)
  const prefixed = typed.startsWith('0x')
  if (label.startsWith(typed)) return 0
  if (label.split(/\s+/).some(word => word.startsWith(typed))) return 1
  if (hex.startsWith(prefixed ? typed.slice(2) : typed)) return 2
  if (label.includes(typed)) return 3
  if (!prefixed && hex.includes(typed)) return 4
  if (label && inOrder(typed, label)) return 5
  return null
}

/** The entries `query` finds, best first; equally good ones keep their order. */
export function matchConversations<T extends Searchable>(query: string, entries: readonly T[]): T[] {
  return entries
    .map((entry, index) => ({ entry, index, score: matchScore(query, entry) }))
    .filter(match => match.score !== null)
    .sort((a, b) => a.score! - b.score! || a.index - b.index)
    .map(match => match.entry)
}

/** The entries `query` finds, in their order, for filtering a list in place. */
export function filterConversations<T extends Searchable>(query: string, entries: readonly T[]): T[] {
  return entries.filter(entry => matchScore(query, entry) !== null)
}
