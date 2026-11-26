import { BoxRenderable, StyledText, TextRenderable, fg, t, type CliRenderer, type KeyEvent, type PasteEvent, type TextChunk } from '@opentui/core'
import { checksumAddress } from '../../src/shared/address'
import { generateKeypair, type Keypair } from '../../src/shared/keypair'
import { errorMessage } from '../../src/client/lib/errors'
import { ClientUpdateRequiredError, serverName } from '../../src/cli/client'
import { createIdentity, parsePrivateKey } from '../../src/cli/identity'
import { terminalText } from '../../src/cli/terminal-text'
import { PRIORITY } from './bar'
import { HintBar } from './hints'
import { IdentitySession, OUTDATED } from './identity-session'
import { Modals } from './modals'
import { COLORS, resolveTheme, setTheme, type ThemeSetting } from './theme'
import type { DesktopTheme } from './omarchy-theme'

export interface FirstRunOptions {
  server: string
  /** Where to save the identity, as the CLI does. */
  identityPath: string
  /** Default: system, which follows the terminal's background. */
  theme?: ThemeSetting
  /** The Omarchy desktop's theme, for the `omarchy` setting. */
  desktopTheme?: DesktopTheme
}

type Choice = 'create' | 'import' | 'quit'

/** What the welcome says about the key, after site/your-key.md. */
export const WELCOME = 'hushhash needs an identity to chat: a private key, made and kept on this computer. '
  + 'Your private key is your account. Anyone who has it can read your messages and send messages as you, '
  + 'so keep it to yourself. The server never has it, so it cannot be recovered if you lose it; '
  + '/key backs it up once you are in.'

export const IMPORT_HELP = 'Paste a private key you backed up from hushhash: 64 hexadecimal characters, with or without 0x. '
  + 'It is never shown. Never import a key from a crypto wallet that holds money or anything else of value.'

/**
 * The welcome screen for a terminal without an identity: create a new one
 * or import a key, sign in to the server, then save it where the CLI looks.
 * Nothing is saved until the server has accepted it, so a failed attempt
 * leaves no identity behind and can simply be tried again.
 */
export class FirstRun {
  private readonly root: BoxRenderable
  private readonly status: TextRenderable
  private readonly hintBar: HintBar
  private readonly modals: Modals
  /** The session signing in, so quitting can stop it. */
  private signingIn: IdentitySession | null = null
  /** A new key, kept for a retry so a retry does not make another. */
  private created: Keypair | null = null
  private stopped = false

  constructor(private readonly renderer: CliRenderer, private readonly options: FirstRunOptions) {
    setTheme(resolveTheme(options.theme ?? 'system', renderer.themeMode, options.desktopTheme?.current))
    this.root = new BoxRenderable(renderer, { width: '100%', height: '100%', flexDirection: 'column' })
    const body = new BoxRenderable(renderer, { flexGrow: 1, justifyContent: 'center', alignItems: 'center' })
    this.status = new TextRenderable(renderer, { content: '', fg: COLORS.muted })
    body.add(this.status)
    this.hintBar = new HintBar(renderer)
    this.root.add(body)
    this.root.add(this.hintBar.view)
    renderer.root.add(this.root)
    this.modals = new Modals(renderer, this.root, () => this.renderHints())
    this.modals.applyTheme()
    renderer.keyInput.on('keypress', this.onKey)
    renderer.keyInput.on('paste', this.onPaste)
    renderer.once('destroy', this.stop)
    this.renderHints()
  }

  /** Runs until there is an identity, signed in, or you quit (null). */
  async run(): Promise<IdentitySession | null> {
    let problem: string | null = null
    try {
      while (!this.stopped) {
        const choice = await this.modals.choose<Choice>({
          title: 'Welcome to hushhash',
          width: 76,
          label: welcomeLabel(problem),
          action: 'choose',
          cancel: 'quit',
          items: () => [
            { label: 'Create a new identity', detail: 'a new key, made here', value: 'create' },
            { label: 'Import a key', detail: 'paste one you backed up', value: 'import' },
            { label: 'Quit', value: 'quit' },
          ],
        })
        if (choice === null || choice === 'quit' || this.stopped) return null
        const keypair = choice === 'create' ? this.created ??= generateKeypair() : await this.askForKey()
        // Back from the import prompt: choose again.
        if (!keypair) { problem = null; continue }
        const result = await this.setUp(keypair)
        if (typeof result === 'string') { problem = result; continue }
        // Saved, but you quit meanwhile; the next start signs in with it.
        if (this.stopped) { await result.close().catch(() => {}); return null }
        return result
      }
      return null
    } finally {
      this.dispose()
    }
  }

  /** Quits: whatever is open closes and run() settles with null. */
  readonly stop = () => {
    if (this.stopped) return
    this.stopped = true
    this.signingIn?.abort()
    this.modals.close()
  }

  private async askForKey(): Promise<Keypair | null> {
    const key = await this.modals.prompt({
      title: 'Import a key',
      label: IMPORT_HELP,
      placeholder: 'Paste your private key',
      action: 'import',
      secret: true,
      validate: value => { try { parsePrivateKey(value); return null } catch (error) { return errorMessage(error, 'Invalid private key') } },
    })
    return key === null || this.stopped ? null : parsePrivateKey(key)
  }

  /** Signs in with `keypair` (registering it), then saves it; the session, or what went wrong. */
  private async setUp(keypair: Keypair): Promise<IdentitySession | string> {
    const { server, identityPath } = this.options
    const session = this.signingIn = new IdentitySession(server, keypair)
    this.showStatus(`Signing in to ${serverName(server)} as ${checksumAddress(keypair.address)}…`)
    try {
      try {
        await session.login()
      } catch (error) {
        if (session.signal.reason instanceof ClientUpdateRequiredError) return OUTDATED
        return `Cannot sign in to ${serverName(server)}: ${errorMessage(error, 'unknown error')}. Nothing was saved; try again.`
      }
      if (this.stopped) return 'Stopped'
      try {
        await createIdentity(identityPath, keypair.privateKey)
      } catch (error) {
        return `Could not save the identity to ${terminalText(identityPath)}: ${errorMessage(error, 'unknown error')}`
      }
      // The app takes the session over.
      this.signingIn = null
      return session
    } finally {
      if (this.signingIn === session) {
        this.signingIn = null
        await session.close().catch(() => {})
      }
      this.showStatus('')
    }
  }

  private showStatus(text: string): void {
    if (!this.root.isDestroyed) this.status.content = text
    this.renderHints()
  }

  private renderHints(): void {
    this.hintBar.render(this.modals.hints ?? [{ keys: 'Ctrl+C', action: 'quit', priority: PRIORITY.essential }])
  }

  private readonly onKey = (key: KeyEvent) => {
    if (key.ctrl && key.name === 'c') {
      key.preventDefault()
      this.stop()
    } else {
      // Nothing else answers while signing in.
      this.modals.handleKey(key)
    }
  }

  private readonly onPaste = (event: PasteEvent) => this.modals.handlePaste(event)

  /** Leaves the screen to the app. */
  private dispose(): void {
    this.modals.close()
    this.renderer.keyInput.off('keypress', this.onKey)
    this.renderer.keyInput.off('paste', this.onPaste)
    this.renderer.off('destroy', this.stop)
    if (this.root.isDestroyed) return
    this.renderer.root.remove(this.root)
    this.root.destroyRecursively()
  }
}

function welcomeLabel(problem: string | null): StyledText {
  const chunks: TextChunk[] = []
  if (problem) chunks.push(...t`${fg(COLORS.error)(problem)}\n\n`.chunks)
  chunks.push(...t`${WELCOME}`.chunks)
  return new StyledText(chunks)
}
