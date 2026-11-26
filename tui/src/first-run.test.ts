import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestRenderer } from '@opentui/core/testing'
import { initDb, getDb, getPubkey } from '../../src/server/db'
import { createFetch } from '../../src/server/router'
import * as limiters from '../../src/server/rate-limiters'
import * as constants from '../../src/server/constants'
import { generateKeypair } from '../../src/shared/keypair'
import { loadIdentity } from '../../src/cli/identity'
import { FirstRun } from './first-run'
import type { IdentitySession } from './identity-session'

type Setup = Awaited<ReturnType<typeof createTestRenderer>>

let server: ReturnType<typeof Bun.serve>
let setup: Setup
let directory: string
let identityPath: string
let logging: ReturnType<typeof spyOn>
/** While true, the server answers every request with 503. */
let down: boolean
let session: IdentitySession | null

beforeEach(async () => {
  initDb(':memory:')
  for (const limiter of Object.values(limiters)) limiter.reset()
  logging = spyOn(constants, 'log').mockImplementation(() => {})
  down = false
  session = null
  const fetch = createFetch()
  server = Bun.serve({
    port: 0, hostname: '127.0.0.1',
    fetch: (request, bun) => down ? new Response('{"error":"Service unavailable"}', { status: 503 }) : fetch(request, bun),
  })
  directory = mkdtempSync(join(tmpdir(), 'hushhash-tui-first-run-'))
  identityPath = join(directory, 'hushhash', 'identity.json')
  setup = await createTestRenderer({ width: 100, height: 30 })
})

afterEach(async () => {
  setup.renderer.destroy()
  await session?.close()
  await server.stop(true)
  logging.mockRestore()
  getDb().close()
  rmSync(directory, { recursive: true, force: true })
})

function frame(): string {
  return setup.captureCharFrame()
}

async function until(check: () => boolean, description: string, timeout = 4000) {
  const deadline = performance.now() + timeout
  await setup.renderOnce()
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`Timed out: ${description}\n${frame()}`)
    await Bun.sleep(20)
    await setup.renderOnce()
  }
}

/** Shows the welcome screen; `done` settles as run() does. */
async function welcome(): Promise<{ done: Promise<IdentitySession | null> }> {
  const done = new FirstRun(setup.renderer, { server: server.url.origin, identityPath }).run()
  await until(() => frame().includes('Welcome to hushhash'), 'welcome screen')
  return { done }
}

test('creates a new identity: registered, signed in, then saved where the CLI looks', async () => {
  const { done: run } = await welcome()
  expect(frame()).toContain('Your private key is your account')
  expect(frame()).toContain('Create a new identity')
  expect(frame()).toContain('Import a key')
  setup.mockInput.pressEnter()
  session = await run
  expect(session).not.toBeNull()
  expect(getPubkey(session!.address)).not.toBeNull()
  expect((await session!.conversations()).conversations).toEqual([])
  expect((await loadIdentity(identityPath)).address).toBe(session!.address)
  expect(statSync(identityPath).mode & 0o777).toBe(0o600)
  // The screen is left to the app.
  await setup.renderOnce()
  expect(frame()).not.toContain('Welcome to hushhash')
})

test('imports a pasted key without ever drawing it, after rejecting one that is not a key', async () => {
  const keypair = generateKeypair()
  const { done: run } = await welcome()
  setup.mockInput.pressArrow('down')
  setup.mockInput.pressEnter()
  await until(() => frame().includes('Paste your private key'), 'import prompt')

  await setup.mockInput.typeText('nope')
  setup.mockInput.pressEnter()
  await until(() => frame().includes('Expected a 32-byte hexadecimal private key'), 'invalid key rejected')
  expect(frame()).not.toContain('nope')
  setup.mockInput.pressKey('u', { ctrl: true })

  await setup.mockInput.pasteBracketedText(`${keypair.privateKey}\n`)
  await until(() => frame().includes('66 characters'), 'pasted key counted')
  expect(frame()).not.toContain(keypair.privateKey.slice(2, 12))
  setup.mockInput.pressEnter()
  session = await run
  expect(session!.address).toBe(keypair.address)
  expect(getPubkey(keypair.address)).not.toBeNull()
  expect((await loadIdentity(identityPath)).privateKey).toBe(keypair.privateKey)
})

test('a connection error is shown, saves nothing, and can be retried', async () => {
  down = true
  const { done: run } = await welcome()
  setup.mockInput.pressEnter()
  await until(() => frame().includes('Cannot sign in'), 'error shown')
  expect(frame()).toContain('saved; try again')
  expect(existsSync(identityPath)).toBe(false)

  down = false
  setup.mockInput.pressEnter()
  session = await run
  expect(session).not.toBeNull()
  expect((await loadIdentity(identityPath)).address).toBe(session!.address)
})

test('Esc on the welcome screen, or Ctrl+C, quits without an identity', async () => {
  const { done: run } = await welcome()
  setup.mockInput.pressEscape()
  expect(await run).toBeNull()
  expect(existsSync(identityPath)).toBe(false)

  const { done: again } = await welcome()
  setup.mockInput.pressCtrlC()
  expect(await again).toBeNull()
  expect(existsSync(identityPath)).toBe(false)
})

test('Esc in the import prompt goes back to the welcome screen', async () => {
  const { done: run } = await welcome()
  setup.mockInput.pressArrow('down')
  setup.mockInput.pressEnter()
  await until(() => frame().includes('Paste your private key'), 'import prompt')
  setup.mockInput.pressEscape()
  await until(() => frame().includes('Create a new identity'), 'back to the welcome screen')
  setup.mockInput.pressEnter()
  session = await run
  expect(session).not.toBeNull()
})
