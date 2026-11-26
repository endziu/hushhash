/** A slash command, as completion and help describe it. */
export interface CommandInfo {
  name: string
  aliases?: readonly string[]
  /** What follows the name, such as ADDRESS [NAME]. */
  usage?: string
  /** Completing it waits for the rest of the line, rather than running it bare. */
  needsMore?: boolean
  description: string
}

export const COMMANDS: readonly CommandInfo[] = [
  { name: 'open', aliases: ['new'], usage: 'ADDRESS [NAME]', needsMore: true, description: 'start or switch conversation, naming it' },
  { name: 'name', usage: '[NAME]', needsMore: true, description: 'name this conversation on this device; empty removes it' },
  { name: 'remove', description: 'take this conversation off the list here (asks first)' },
  { name: 'ttl', usage: '[5m|300]', description: 'lifetime of new messages; alone, a list to pick from' },
  { name: 'theme', usage: '[system|light|dark]', description: 'colours; system follows the terminal' },
  { name: 'clear', description: 'delete all messages for both of you (asks first)' },
  { name: 'retry', description: 'retry loading or opening' },
  { name: 'older', description: 'load older messages' },
  { name: 'share', aliases: ['address'], description: 'your address, link and QR code' },
  { name: 'key', description: 'back up your private key' },
  { name: 'log', description: 'toggle the debug log' },
  { name: 'help', description: 'the keys and commands' },
  { name: 'quit', aliases: ['exit'], description: 'quit' },
]

/** A command that completes what was typed, and the word to complete it with: its name or the alias typed. */
export interface Completion {
  command: CommandInfo
  word: string
}

/**
 * The commands that complete `text`, an exact match first, else in list
 * order. Empty unless `text` is a command name being typed: one line that
 * starts with a single /, with no space yet, so arguments, //text and
 * multi-line text get none.
 */
export function completeCommands(text: string): Completion[] {
  if (!/^\/[^\s/]*$/.test(text)) return []
  const typed = text.slice(1).toLowerCase()
  const completions: Completion[] = []
  for (const command of COMMANDS) {
    const words = [command.name, ...command.aliases ?? []]
    const word = words.find(candidate => candidate === typed) ?? words.find(candidate => candidate.startsWith(typed))
    if (word) completions.push({ command, word })
  }
  const exact = completions.findIndex(({ word }) => word === typed)
  if (exact > 0) completions.unshift(...completions.splice(exact, 1))
  return completions
}

/** What completing with `completion` leaves in the composer: a space after it when arguments follow. */
export function completedText({ command, word }: Completion): string {
  return command.usage ? `/${word} ` : `/${word}`
}

/** One line of help for `command`. */
export function commandHelpLine({ name, aliases, usage, description }: CommandInfo): string {
  const head = `/${name}${usage ? ` ${usage}` : ''}`
  const also = aliases?.length ? ` (also ${aliases.map(alias => `/${alias}`).join(', ')})` : ''
  return `  ${head.length >= 18 ? `${head}  ` : head.padEnd(19)}${description}${also}`
}
