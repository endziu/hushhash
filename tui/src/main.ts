#!/usr/bin/env bun
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { createCliRenderer } from '@opentui/core'
import { requireAddress } from '../../src/shared/address'
import { ClientUpdateRequiredError, serverOrigin } from '../../src/cli/client'
import { DEFAULT_IDENTITY_HELP, defaultIdentityPath, loadIdentity } from '../../src/cli/identity'
import { terminalText } from '../../src/cli/terminal-text'
import { FALLBACK_MESSAGE_LIFETIME } from '../../src/client/lib/message-lifetime'
import { IdentitySession, OUTDATED } from './identity-session'
import { FirstRun } from './first-run'
import { TuiState, statePath } from './state'
import { App } from './app'
import { LIFETIME_CHOICES_TEXT, lifetimeLabel, parseLifetime } from './lifetime'
import { THEME_SETTINGS, parseThemeSetting } from './theme'
import { OmarchyThemeWatcher, omarchyThemeDir, readOmarchyTheme } from './omarchy-theme'

const HELP = `hushhash TUI — full-screen encrypted chat with a hushhash server

Usage: bun run start [options] [ADDRESS]

  ADDRESS                  Open this conversation at start

Options:
  --server ORIGIN          prod, local, or an explicit origin (HTTPS remotely)
                           Default: HUSHHASH_SERVER or local (http://localhost:3000)
  --identity FILE          Default: ${DEFAULT_IDENTITY_HELP}
  --ttl LIFETIME           Lifetime of sent messages, such as 5m or 300 (default: ${lifetimeLabel(FALLBACK_MESSAGE_LIFETIME)})
  --theme THEME            system, omarchy, light or dark (default: omarchy on
                           Omarchy, which follows the desktop's theme; elsewhere
                           system, which follows the terminal's background)
  --help                   Show this help

The TUI uses the same identity file as the CLI. Without one, it offers to
create a new identity or import a key, and saves it there.
`

// Saves the terminal's title before the TUI changes it, and puts it back after (XTWINOPS).
const PUSH_TITLE = '\x1b[22;0t'
const POP_TITLE = '\x1b[23;0t'

export async function main(args = process.argv.slice(2)): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
    server: { type: 'string' }, identity: { type: 'string' }, ttl: { type: 'string' }, theme: { type: 'string' }, help: { type: 'boolean' },
  } })
  if (values.help) { console.log(HELP); return }
  if (positionals.length > 1) throw new Error('Expected at most one ADDRESS')
  const partner = positionals[0] === undefined ? undefined : requireAddress(positionals[0])
  const ttl = values.ttl === undefined ? FALLBACK_MESSAGE_LIFETIME : parseLifetime(values.ttl)
  if (ttl === null) throw new Error(`Unsupported --ttl; use one of ${LIFETIME_CHOICES_TEXT}`)
  const themeSetting = values.theme === undefined ? undefined : parseThemeSetting(values.theme)
  if (themeSetting === null) throw new Error(`Unsupported --theme; use one of ${THEME_SETTINGS.join(', ')}`)
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('The TUI needs an interactive terminal; use the CLI for scripts')
  const onOmarchy = readOmarchyTheme(omarchyThemeDir()) !== null
  if (themeSetting === 'omarchy' && !onOmarchy) throw new Error(`No Omarchy theme at ${omarchyThemeDir()}; use another --theme`)
  const theme = themeSetting ?? (onOmarchy ? 'omarchy' : 'system')
  const server = serverOrigin(values.server ?? process.env.HUSHHASH_SERVER ?? 'local')
  const identityPath = resolve(values.identity ?? defaultIdentityPath())
  let identity = null
  try { identity = await loadIdentity(identityPath) }
  catch (error) {
    // No identity yet: the welcome screen makes one.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  let identitySession: IdentitySession | null = null
  const desktopTheme = new OmarchyThemeWatcher()
  try {
    if (identity) {
      identitySession = new IdentitySession(server, identity)
      const session = identitySession
      // Fail before taking over the screen, so connection errors stay readable.
      await session.login().catch(cause => {
        throw session.signal.reason instanceof ClientUpdateRequiredError
          ? new Error(OUTDATED)
          : new Error(`Cannot sign in to ${server}: ${cause instanceof Error ? cause.message : 'unknown error'}`)
      })
    }
    process.stdout.write(PUSH_TITLE)
    try {
      const renderer = await createCliRenderer({ exitOnCtrlC: false, targetFps: 30 })
      try {
        identitySession ??= await new FirstRun(renderer, { server, identityPath, theme, desktopTheme }).run()
        if (identitySession) {
          const state = TuiState.load(statePath(identityPath), identitySession.address)
          const app = new App(renderer, identitySession, { server, ttl, partner, theme, desktopTheme, state, identityPath })
          await app.run()
        }
      } finally {
        // Quitting already did this; anything else gives the terminal back here.
        renderer.destroy()
        await renderer.closed
      }
    } finally {
      process.stdout.write(POP_TITLE)
    }
  } finally {
    desktopTheme.close()
    await identitySession?.close().catch(() => console.error('Session cleanup failed; it will expire automatically.'))
  }
  if (identitySession?.signal.reason instanceof ClientUpdateRequiredError) throw new Error(OUTDATED)
}

if (import.meta.main) {
  main().catch(error => {
    console.error(`hushhash-tui: ${terminalText(error instanceof Error ? error.message : 'Unknown error')}`)
    process.exitCode = 1
  })
}
