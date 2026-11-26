import { StyledText, fg, link, underline, type TextChunk } from '@opentui/core'
import { splitMessageLinks } from '../../src/client/lib/message-links'
import { terminalText } from '../../src/cli/terminal-text'
import { COLORS } from './theme'

/**
 * A message as styled text: http and https links underlined in the accent
 * colour and, where the terminal supports hyperlinks, clickable. Both a
 * link's text and its URL go through terminalText, so no control character
 * reaches the terminal, inside the hyperlink escape or out of it.
 */
export function messageText(message: string, hyperlinks: boolean): StyledText {
  return new StyledText(splitMessageLinks(message).map((part): TextChunk => {
    if (part.type === 'text') return { __isChunk: true, text: terminalText(part.value, { newlines: true }) }
    const shown = underline(fg(COLORS.accent)(terminalText(part.value)))
    return hyperlinks ? link(terminalText(part.value))(shown) : shown
  }))
}
