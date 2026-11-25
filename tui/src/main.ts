#!/usr/bin/env bun
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { createCliRenderer } from '@opentui/core'
import { requireAddress } from '../../src/shared/address'
import { ClientUpdateRequiredError, serverOrigin } from '../../src/cli/client'
import { DEFAULT_IDENTITY_HELP, defaultIdentityPath, loadIdentity } from '../../src/cli/identity'
import { terminalText } from '../../src/cli/terminal-text'
import { FALLBACK_MESSAGE_LIFETIME } from '../../src/client/lib/message-lifetime'
import { IdentitySession } from './identity-session'
import { App } from './app'
import { LIFETIME_CHOICES_TEXT, lifetimeLabel, parseLifetime } from './lifetime'
import { THEME_SETTINGS, parseThemeSetting } from './theme'

const HELP = `hushhash TUI — full-screen encrypted chat with a hushhash server

Usage: bun run start [options] [ADDRESS]

  ADDRESS                  Open this conversation at start

Options:
  --server ORIGIN          prod, local, or an explicit origin (HTTPS remotely)
                           Default: HUSHHASH_SERVER or local (http://localhost:3000)
  --identity FILE          Default: ${DEFAULT_IDENTITY_HELP}
  --ttl LIFETIME           Lifetime of sent messages, such as 5m or 300 (default: ${lifetimeLabel(FALLBACK_MESSAGE_LIFETIME)})
  --theme THEME            system, light or dark (default: system, which follows
                           the terminal's background)
  --help                   Show this help

The TUI uses the same identity file as the CLI. Create one with
  bun run cli --server prod init
from the repository root.
`

// The CLI's ClientUpdateRequiredError advice, for this package's two installs.
const OUTDATED = 'This hushhash TUI is out of date for this server. Run git pull, then bun install in the repository and in tui/.'

export async function main(args = process.argv.slice(2)): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
    server: { type: 'string' }, identity: { type: 'string' }, ttl: { type: 'string' }, theme: { type: 'string' }, help: { type: 'boolean' },
  } })
  if (values.help) { console.log(HELP); return }
  if (positionals.length > 1) throw new Error('Expected at most one ADDRESS')
  const partner = positionals[0] === undefined ? undefined : requireAddress(positionals[0])
  const ttl = values.ttl === undefined ? FALLBACK_MESSAGE_LIFETIME : parseLifetime(values.ttl)
  if (ttl === null) throw new Error(`Unsupported --ttl; use one of ${LIFETIME_CHOICES_TEXT}`)
  const theme = values.theme === undefined ? 'system' : parseThemeSetting(values.theme)
  if (theme === null) throw new Error(`Unsupported --theme; use one of ${THEME_SETTINGS.join(', ')}`)
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('The TUI needs an interactive terminal; use the CLI for scripts')
  const server = serverOrigin(values.server ?? process.env.HUSHHASH_SERVER ?? 'local')
  const identityPath = resolve(values.identity ?? defaultIdentityPath())
  let identity
  try { identity = await loadIdentity(identityPath) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`No identity at ${identityPath}. Create one from the repository root with: bun run cli --server ${values.server ?? 'prod'} init`)
    }
    throw error
  }

  const identitySession = new IdentitySession(server, identity)
  try {
    // Fail before taking over the screen, so connection errors stay readable.
    await identitySession.login().catch(cause => {
      throw identitySession.signal.reason instanceof ClientUpdateRequiredError
        ? new Error(OUTDATED)
        : new Error(`Cannot sign in to ${server}: ${cause instanceof Error ? cause.message : 'unknown error'}`)
    })
    const renderer = await createCliRenderer({ exitOnCtrlC: false, targetFps: 30 })
    const app = new App(renderer, identitySession, { server, ttl, partner, theme })
    await app.run()
    await renderer.closed
  } finally {
    await identitySession.close().catch(() => console.error('Session cleanup failed; it will expire automatically.'))
  }
  if (identitySession.signal.reason instanceof ClientUpdateRequiredError) throw new Error(OUTDATED)
}

if (import.meta.main) {
  main().catch(error => {
    console.error(`hushhash-tui: ${terminalText(error instanceof Error ? error.message : 'Unknown error')}`)
    process.exitCode = 1
  })
}
