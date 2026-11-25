#!/usr/bin/env bun
import { parseArgs } from 'node:util'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createCliRenderer } from '@opentui/core'
import { requireAddress } from '../../src/shared/address'
import { serverOrigin } from '../../src/cli/client'
import { loadIdentity } from '../../src/cli/identity'
import { IdentitySession, ClientUpdateRequiredError } from './identity-session'
import { App, DEFAULT_LIFETIME, lifetimeLabel, parseLifetime } from './app'
import { safeText } from './text'

const HELP = `hushhash TUI — full-screen encrypted chat with a hushhash server

Usage: bun run start [options] [ADDRESS]

  ADDRESS                  Open this conversation at start

Options:
  --server ORIGIN          prod, local, or an explicit origin (HTTPS remotely)
                           Default: HUSHHASH_SERVER or local (http://localhost:3000)
  --identity FILE          Default: HUSHHASH_IDENTITY or ~/.config/hushhash/identity.json
  --ttl LIFETIME           Lifetime of sent messages, such as 5m or 300 (default: ${lifetimeLabel(DEFAULT_LIFETIME)})
  --help                   Show this help

The TUI uses the same identity file as the CLI. Create one with
  bun run cli --server prod init
from the repository root.
`

export async function main(args = process.argv.slice(2)): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
    server: { type: 'string' }, identity: { type: 'string' }, ttl: { type: 'string' }, help: { type: 'boolean' },
  } })
  if (values.help) { console.log(HELP); return }
  if (positionals.length > 1) throw new Error('Expected at most one ADDRESS')
  const partner = positionals[0] === undefined ? undefined : requireAddress(positionals[0])
  const ttl = values.ttl === undefined ? DEFAULT_LIFETIME : parseLifetime(values.ttl)
  if (ttl === null) throw new Error('Unsupported --ttl; use 5s, 10s, 30s, 1m, 5m, 30m, 1h, 6h or 24h')
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('The TUI needs an interactive terminal; use the CLI for scripts')
  const server = serverOrigin(values.server ?? process.env.HUSHHASH_SERVER ?? 'local')
  const identityPath = resolve(values.identity ?? process.env.HUSHHASH_IDENTITY
    ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'hushhash', 'identity.json'))
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
        ? identitySession.signal.reason
        : new Error(`Cannot sign in to ${server}: ${cause instanceof Error ? cause.message : 'unknown error'}`)
    })
    const renderer = await createCliRenderer({ exitOnCtrlC: false, targetFps: 30 })
    const app = new App(renderer, identitySession, { server, ttl, partner })
    await app.run()
    await renderer.closed
  } finally {
    await identitySession.close().catch(() => console.error('Session cleanup failed; it will expire automatically.'))
  }
  if (identitySession.signal.reason instanceof ClientUpdateRequiredError) throw identitySession.signal.reason
}

if (import.meta.main) {
  main().catch(error => {
    console.error(`hushhash-tui: ${safeText(error instanceof Error ? error.message : 'Unknown error')}`)
    process.exitCode = 1
  })
}
