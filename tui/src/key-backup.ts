import { StyledText, bold, dim, fg, t, type TextChunk } from '@opentui/core'
import { checksumAddress, type Address } from '../../src/shared/address'
import { terminalText } from '../../src/cli/terminal-text'
import { COLORS } from './theme'

/** What the browser and site/your-key.md say about the key. */
export const KEY_WARNING = 'Your private key is your account: anyone who has it can read your messages and send messages as you, '
  + 'so keep it secret. The server never has it, so it cannot be recovered if you lose it. '
  + 'Use the key hushhash creates for you; never import a key from a crypto wallet that holds money or anything else of value.'

export const COPY_WARNING = 'Your clipboard, and your terminal\'s scrollback, may keep the key after you copy or show it.'

/** Shown instead of the key until v reveals it. */
export const HIDDEN_KEY = '•••• •••• •••• •••• ••••'

export interface KeyDetails {
  address: Address
  privateKey: string
  /** Where the identity file is; null when unknown. */
  path: string | null
  revealed: boolean
  /** Your avatar's rows, when the terminal can draw it. */
  avatar: StyledText[] | null
}

/** The Key panel's content: who you are, where the key lives and, once revealed, the key. */
export function keyContent({ address, privateKey, path, revealed, avatar }: KeyDetails): StyledText {
  const chunks: TextChunk[] = []
  const line = (text: StyledText) => chunks.push(...text.chunks, ...t`\n`.chunks)
  const beside = (row: number) => avatar ? [...avatar[row]!.chunks, ...t`  `.chunks] : []
  line(new StyledText([...beside(0), ...t`${fg(COLORS.you)(checksumAddress(address))}`.chunks]))
  line(new StyledText([...beside(1), ...t`${dim(path ? `Saved in ${terminalText(path)}` : 'Saved in your identity file')}`.chunks]))
  line(t``)
  line(t`${bold('Private key')}  ${dim(revealed ? '(v hides it)' : '(v shows it)')}`)
  line(revealed ? t`${fg(COLORS.warning)(privateKey)}` : t`${fg(COLORS.muted)(HIDDEN_KEY)}`)
  line(t``)
  line(t`${KEY_WARNING}`)
  line(t``)
  chunks.push(...t`${fg(COLORS.warning)(COPY_WARNING)}`.chunks)
  return new StyledText(chunks)
}
