import { StyledText, t } from '@opentui/core'

/** `lines` as one text, a line break between each. */
export function joinLines(lines: readonly StyledText[]): StyledText {
  return new StyledText(lines.flatMap((line, index) => index === 0 ? line.chunks : [...t`${'\n'}`.chunks, ...line.chunks]))
}
