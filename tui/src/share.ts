import { StyledText, bg, bold, dim, fg, t, type TextChunk } from '@opentui/core'
import QRCode from 'qrcode'
import { checksumAddress, type Address } from '../../src/shared/address'
import type { PanelSpace } from './modals'
import { COLORS, QR_COLORS } from './theme'

/** Light modules around the code, so a scanner finds its edges even on a dark screen. */
const QUIET_ZONE = 2

/** A QR code's modules, row by row from the top, quiet zone included; true is dark. */
export type QrModules = readonly (readonly boolean[])[]

/**
 * The modules of a QR code for `text`. Low error correction keeps a
 * conversation link at 37 columns, which fits more terminals; a screen does
 * not get scratched.
 */
export function qrModules(text: string): QrModules {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'L' })
  const size = modules.size + QUIET_ZONE * 2
  return Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => {
    const column = x - QUIET_ZONE
    const row = y - QUIET_ZONE
    return column >= 0 && row >= 0 && column < modules.size && row < modules.size && modules.get(row, column) === 1
  }))
}

/** Each cell shows two modules stacked: the top, the bottom, both or neither dark. */
function cell(top: boolean, bottom: boolean): string {
  return top ? (bottom ? '█' : '▀') : (bottom ? '▄' : ' ')
}

/** The code as text, one line per two rows of modules; an odd last row has light below it. */
export function qrLines(modules: QrModules): string[] {
  const lines: string[] = []
  for (let y = 0; y < modules.length; y += 2) {
    lines.push(modules[y]!.map((top, x) => cell(top, modules[y + 1]?.[x] ?? false)).join(''))
  }
  return lines
}

export interface ShareDetails {
  address: Address
  link: string
}

// The address, the link, a gap above each and the keys' line.
const DETAIL_ROWS = 6

/**
 * The Share panel's content: the QR code of your conversation link when it
 * fits, else how large the terminal needs to be, then your address and link.
 */
export function shareContent({ address, link }: ShareDetails, space: PanelSpace, terminal: PanelSpace): StyledText {
  const lines = qrLines(qrModules(link))
  const columns = lines[0]!.length
  const chunks: TextChunk[] = []
  if (columns <= space.columns && lines.length + DETAIL_ROWS <= space.rows) {
    const indent = ' '.repeat(Math.floor((space.columns - columns) / 2))
    for (const line of lines) chunks.push(...t`${indent}${bg(QR_COLORS.light)(fg(QR_COLORS.dark)(line))}\n`.chunks)
  } else {
    // The modal takes 90% of the screen, inside its borders and padding.
    const wide = Math.max(terminal.columns, Math.ceil((columns + 4) / 0.9))
    const tall = Math.max(terminal.rows, Math.ceil((lines.length + DETAIL_ROWS + 2) / 0.9))
    chunks.push(...t`${fg(COLORS.muted)(`Make the terminal at least ${wide}×${tall} to show the QR code.`)}\n`.chunks)
  }
  chunks.push(...t`\n${bold('Address')}  ${fg(COLORS.you)(checksumAddress(address))}\n`.chunks)
  chunks.push(...t`\n${bold('Link')}     ${fg(COLORS.accent)(link)}\n`.chunks)
  chunks.push(...t`\n${dim('Scan it or open the link to message you. c copies the address, l the link.')}`.chunks)
  return new StyledText(chunks)
}
