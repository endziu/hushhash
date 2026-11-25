import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { initDb, getDb, savePushSubscription } from '../../src/server/db'
import { createFetch } from '../../src/server/router'
import { setPushSender } from '../../src/server/push'
import * as limiters from '../../src/server/rate-limiters'
import * as constants from '../../src/server/constants'
import { checksumAddress, shortAddress, type Address } from '../../src/shared/address'
import { generateKeypair } from '../../src/shared/keypair'
import { ChatClient } from '../../src/cli/client'
import { Account } from './account'
import { App } from './app'

type Setup = Awaited<ReturnType<typeof createTestRenderer>>

let server: ReturnType<typeof Bun.serve>
let setup: Setup
let account: Account
let app: App
let alice: ChatClient
let pushes: number
let logging: ReturnType<typeof spyOn>

beforeEach(async () => {
  initDb(':memory:')
  for (const limiter of Object.values(limiters)) limiter.reset()
  logging = spyOn(constants, 'log').mockImplementation(() => {})
  pushes = 0
  setPushSender(async () => { pushes++ })
  server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: createFetch() })
  alice = new ChatClient(server.url.origin, generateKeypair())
  await alice.login()
})

afterEach(async () => {
  app?.stop()
  await account?.close()
  await alice.close()
  await server.stop(true)
  setPushSender(undefined)
  logging.mockRestore()
  getDb().close()
})

async function start(partner: Address | undefined = alice.identity.address, height = 32) {
  account = new Account(server.url.origin, generateKeypair())
  await account.login()
  setup = await createTestRenderer({ width: 110, height })
  app = new App(setup.renderer, account, { server: server.url.origin, ttl: 1800, partner })
  void app.run()
  await until(() => frame().includes('● connected'), 'live connection')
}

function frame(): string {
  return setup.captureCharFrame()
}

async function until(check: () => boolean | Promise<boolean>, description: string, timeout = 4000) {
  const deadline = performance.now() + timeout
  while (!await check()) {
    if (performance.now() > deadline) throw new Error(`Timed out: ${description}\n${frame()}`)
    await setup.renderOnce()
    await Bun.sleep(20)
  }
  await setup.renderOnce()
}

/** Clicks the conversation list entry for `address`. */
async function clickConversation(address: Address) {
  const lines = frame().split('\n')
  const y = lines.findIndex(line => line.slice(0, 26).includes(shortAddress(address)))
  if (y < 0) throw new Error(`${shortAddress(address)} is not visible in the list\n${frame()}`)
  await setup.mockMouse.click(lines[y]!.indexOf(shortAddress(address)), y)
  await setup.renderOnce()
}

function paneTitle(): string {
  return frame().split('\n')[1]!.slice(26)
}

function openedAt(id: string): number | null {
  return (getDb().query('SELECT opened_at FROM messages WHERE id = ?').get(id) as { opened_at: number | null }).opened_at
}

async function sentByTui() {
  return (await alice.read(account.address, undefined, { confirmAvailability: false })).messages.filter(message => message.sender === account.address)
}

test('shows and opens an incoming message while the terminal is focused', async () => {
  await start()
  const message = await alice.send(account.address, 'hello terminal')
  await until(() => frame().includes('hello terminal'), 'message rendered')
  expect(openedAt(message.id)).not.toBeNull()
})

test('an unfocused terminal leaves messages unopened and lets push through; focus opens them', async () => {
  await start()
  savePushSubscription(account.address, { endpoint: 'https://push.invalid/tui', p256dh: 'x', auth: 'y' })
  await alice.send(account.address, 'while focused')
  await until(() => frame().includes('while focused'), 'focused message')
  expect(pushes).toBe(0)

  setup.renderer.emit('blur')
  await Bun.sleep(500) // attention settles, then reaches the server
  const away = await alice.send(account.address, 'while away')
  await Bun.sleep(600)
  await setup.renderOnce()
  expect(pushes).toBe(1)
  expect(openedAt(away.id)).toBeNull()
  expect(frame()).not.toContain('while away')

  setup.renderer.emit('focus')
  await until(() => frame().includes('while away'), 'opened on focus')
  expect(openedAt(away.id)).not.toBeNull()
})

test('a multi-line paste stays in the composer and is sent as one message on Enter', async () => {
  await start()
  await setup.mockInput.pasteBracketedText('first line\nsecond line\nthird line')
  await Bun.sleep(400)
  expect(await sentByTui()).toHaveLength(0)
  setup.mockInput.pressEnter()
  await until(async () => (await sentByTui()).length === 1, 'pasted message sent')
  expect((await sentByTui())[0]!.plaintext).toBe('first line\nsecond line\nthird line')
})

test('Alt+Enter adds a line instead of sending', async () => {
  await start()
  await setup.mockInput.typeText('one')
  setup.mockInput.pressEnter({ meta: true })
  await setup.mockInput.typeText('two')
  setup.mockInput.pressEnter()
  await until(async () => (await sentByTui()).length === 1, 'message sent')
  expect((await sentByTui())[0]!.plaintext).toBe('one\ntwo')
})

test('peer control sequences and direction overrides are shown escaped', async () => {
  await start()
  await alice.send(account.address, 'evil \x1b]52;c;UFdORUQ=\x07 abc‮dcba')
  await until(() => frame().includes('evil'), 'hostile message rendered')
  expect(frame()).toContain('\\u001b]52;c;UFdORUQ=\\u0007')
  expect(frame()).toContain('\\u202e')
})

test('/ttl changes the lifetime of later messages', async () => {
  await start()
  await setup.mockInput.typeText('/ttl 5m')
  setup.mockInput.pressEnter()
  await until(() => frame().includes('lifetime 5m'), 'lifetime shown')
  await setup.mockInput.typeText('short lived')
  setup.mockInput.pressEnter()
  await until(async () => (await sentByTui()).length === 1, 'message sent')
  expect((await sentByTui())[0]!.ttl).toBe(300)
})

test('//text sends text that starts with a slash', async () => {
  await start()
  await setup.mockInput.typeText('//shrug')
  setup.mockInput.pressEnter()
  await until(async () => (await sentByTui()).length === 1, 'message sent')
  expect((await sentByTui())[0]!.plaintext).toBe('/shrug')
})

test('marks other conversations unread and opens them from the list', async () => {
  const carol = new ChatClient(server.url.origin, generateKeypair())
  await carol.login()
  try {
    await start(carol.identity.address)
    const message = await alice.send(account.address, 'from alice')
    await until(() => frame().includes(`● ${shortAddress(alice.identity.address)}`), 'unread marker')
    expect(openedAt(message.id)).toBeNull()
    setup.mockInput.pressTab()
    await setup.renderOnce()
    // The list holds carol (opened here) and alice; move to alice and open her.
    const aliceFirst = frame().indexOf(shortAddress(alice.identity.address)) < frame().indexOf(shortAddress(carol.identity.address))
    if (!aliceFirst) setup.mockInput.pressArrow('down')
    else setup.mockInput.pressArrow('up')
    setup.mockInput.pressEnter()
    await until(() => frame().includes('from alice'), 'alice conversation opened')
    expect(openedAt(message.id)).not.toBeNull()
    expect(frame()).not.toContain(`● ${shortAddress(alice.identity.address)}`)
  } finally {
    await carol.close()
  }
})

test('/clear asks for confirmation, then clears for both participants', async () => {
  await start()
  await alice.send(account.address, 'to be cleared')
  await until(() => frame().includes('to be cleared'), 'message rendered')
  await setup.mockInput.typeText('/clear')
  setup.mockInput.pressEnter()
  await until(() => frame().includes('Type /clear again'), 'confirmation asked')
  expect(frame()).toContain('to be cleared')
  await setup.mockInput.typeText('/clear')
  setup.mockInput.pressEnter()
  await until(() => !frame().includes('to be cleared'), 'conversation cleared')
  expect((await alice.read(account.address)).messages).toHaveLength(0)
})

test('an unregistered partner is reported and a failed send keeps its text', async () => {
  await start(generateKeypair().address)
  await until(() => frame().includes('not registered on this server'), 'unregistered notice')
  await setup.mockInput.typeText('nobody home')
  setup.mockInput.pressEnter()
  await until(() => frame().includes('Send failed'), 'send failure')
  expect(frame()).toContain('nobody home')
})

test('clicking a conversation in the list opens it', async () => {
  const carol = new ChatClient(server.url.origin, generateKeypair())
  await carol.login()
  try {
    await start(carol.identity.address)
    const message = await alice.send(account.address, 'clicked open')
    await until(() => frame().includes(`● ${shortAddress(alice.identity.address)}`), 'alice listed')
    await clickConversation(alice.identity.address)
    await until(() => frame().includes('clicked open'), 'alice conversation opened by click')
    expect(openedAt(message.id)).not.toBeNull()
    await clickConversation(carol.identity.address)
    await until(() => paneTitle().includes(checksumAddress(carol.identity.address)), 'carol opened by click')
    expect(frame()).not.toContain('clicked open')
  } finally {
    await carol.close()
  }
})

test('clicking works after the conversation list has scrolled', async () => {
  await start(undefined, 18)
  const addresses = Array.from({ length: 9 }, () => generateKeypair().address)
  for (const address of addresses) {
    await setup.mockInput.typeText(`/open ${address}`)
    setup.mockInput.pressEnter()
    await setup.renderOnce()
  }
  // The newest is listed first; open the oldest from the keyboard so the list scrolls.
  setup.mockInput.pressTab()
  for (let i = 0; i < addresses.length; i++) setup.mockInput.pressArrow('down')
  setup.mockInput.pressEnter()
  await setup.renderOnce()
  expect(frame()).not.toContain(shortAddress(addresses.at(-1)!))
  const target = addresses.find(address => frame().split('\n').some(line => line.slice(0, 26).includes(shortAddress(address))) && address !== addresses[0])!
  await clickConversation(target)
  await until(() => paneTitle().includes(checksumAddress(target)), 'clicked conversation opened')
})
