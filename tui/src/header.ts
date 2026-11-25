import { TextRenderable, dim, fg, t, type CliRenderer } from '@opentui/core'
import { checksumAddress, type Address } from '../../src/shared/address'
import { COLORS } from './theme'

/** The top line: who you are and which server you are on. */
export function createHeader(renderer: CliRenderer, address: Address, server: string): TextRenderable {
  return new TextRenderable(renderer, {
    height: 1,
    content: t` ${fg(COLORS.accent)('hushhash')}  ${checksumAddress(address)} ${dim('(you)')}  ${dim(server)}`,
  })
}
