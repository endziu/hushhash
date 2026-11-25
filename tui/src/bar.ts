import { StyledText } from '@opentui/core'

/** One part of a one-line bar. A lower `priority` is more important. */
export interface BarItem {
  text: StyledText
  priority: number
}

/**
 * Joins as many of `items` as fit in `width` columns with `separator`,
 * keeping their order. The least important go first, the later of equals
 * before the earlier.
 */
export function fitBar(items: readonly BarItem[], width: number, separator: StyledText): StyledText {
  const kept = [...items]
  const gap = columns(separator)
  const total = () => kept.reduce((sum, item) => sum + columns(item.text), 0) + gap * Math.max(0, kept.length - 1)
  while (kept.length > 0 && total() > width) {
    let drop = kept.length - 1
    for (let index = drop - 1; index >= 0; index--) if (kept[index]!.priority > kept[drop]!.priority) drop = index
    kept.splice(drop, 1)
  }
  return new StyledText(kept.flatMap((item, index) => index === 0 ? item.text.chunks : [...separator.chunks, ...item.text.chunks]))
}

function columns(text: StyledText): number {
  return Bun.stringWidth(text.chunks.map(chunk => chunk.text).join(''))
}
