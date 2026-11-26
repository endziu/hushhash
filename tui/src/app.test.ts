import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RGBA } from '@opentui/core'
import { createTestRenderer, setRendererCapabilities } from '@opentui/core/testing'
import { initDb, getDb, savePushSubscription } from '../../src/server/db'
import { createFetch } from '../../src/server/router'
import { setPushSender } from '../../src/server/push'
import * as limiters from '../../src/server/rate-limiters'
import * as constants from '../../src/server/constants'
import { checksumAddress, shortAddress, type Address } from '../../src/shared/address'
import { generateKeypair, type Keypair } from '../../src/shared/keypair'
import { ChatClient } from '../../src/cli/client'
import { IdentitySession } from './identity-session'
import { App } from './app'
import { sidebarWidth } from './sidebar'
import { PALETTES, setTheme, type ThemeSetting } from './theme'
import { TuiState } from './state'
import { HIDDEN_KEY } from './key-backup'

type Setup = Awaited<ReturnType<typeof createTestRenderer>>

let server: ReturnType<typeof Bun.serve>
let setup: Setup
let identitySession: IdentitySession
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
  await identitySession?.close()
  await alice.close()
  await server.stop(true)
  setPushSender(undefined)
  logging.mockRestore()
  getDb().close()
  setTheme('dark')
  for (const cleanup of cleanups.splice(0)) cleanup()
})

interface StartOptions {
  width?: number
  theme?: ThemeSetting
  /** Report a truecolor terminal, so avatars are drawn. */
  truecolor?: boolean
  /** Report a terminal that supports hyperlinks. */
  hyperlinks?: boolean
  /** The identity file shown in the Key panel. */
  identityPath?: string
  /** The identity to sign in as; default: a new one. */
  keypair?: Keypair
  /** A state file to load; default: state in memory. */
  statePath?: string
}

/** Opens `partner` at start, Alice by default; null opens nothing. */
async function start(partner: Address | null | undefined = alice.identity.address, height = 32, idleMs?: number, options: StartOptions = {}) {
  const keypair = options.keypair ?? generateKeypair()
  identitySession = new IdentitySession(server.url.origin, keypair)
  await identitySession.login()
  setup = await createTestRenderer({ width: options.width ?? 110, height })
  if (options.truecolor) setRendererCapabilities(setup.renderer, { rgb: true })
  if (options.hyperlinks) setRendererCapabilities(setup.renderer, { hyperlinks: true })
  const state = options.statePath ? TuiState.load(options.statePath, keypair.address) : undefined
  app = new App(setup.renderer, identitySession, { server: server.url.origin, ttl: 1800, partner: partner ?? undefined, idleMs, theme: options.theme, state, identityPath: options.identityPath })
  void app.run()
  await until(() => frame().includes('● connected'), 'live connection')
}

/** Quits the app and signs it out, as quitting the TUI does. */
async function quit() {
  app.stop()
  await identitySession.close()
}

/** A fresh state file path, removed after the test. */
function tempStatePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'hushhash-tui-app-'))
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  return join(directory, 'tui-state.json')
}

const cleanups: (() => void)[] = []

function frame(): string {
  return setup.captureCharFrame()
}

async function until(check: () => boolean | Promise<boolean>, description: string, timeout = 4000) {
  const deadline = performance.now() + timeout
  // Render first: the frame may be stale, or still being drawn.
  await setup.renderOnce()
  while (!await check()) {
    if (performance.now() > deadline) throw new Error(`Timed out: ${description}\n${frame()}`)
    await Bun.sleep(20)
    await setup.renderOnce()
  }
}

/** Clicks the conversation list entry for `address`. */
async function clickConversation(address: Address) {
  const lines = frame().split('\n')
  const y = lines.findIndex(line => line.slice(0, listWidth()).includes(shortAddress(address)))
  if (y < 0) throw new Error(`${shortAddress(address)} is not visible in the list\n${frame()}`)
  await setup.mockMouse.click(lines[y]!.indexOf(shortAddress(address)), y)
  await setup.renderOnce()
}

/** The list row of `label`, if it is on screen. */
function listRow(label: string): string | undefined {
  return frame().split('\n').map(line => line.slice(0, listWidth())).find(line => line.includes(label))
}

/** The unread count shown beside `label` in the list, or null. */
function unreadShown(label: string): string | null {
  return listRow(label)?.match(/ (\d\+?|9\+) │?\s*$/)?.[1] ?? null
}

/** The status bar, on the top line. */
function statusLine(): string {
  return frame().split('\n')[0]!
}

/** The hint bar, on the bottom line. */
function hintLine(): string {
  return frame().trimEnd().split('\n').at(-1)!
}

function shownAway(): boolean {
  return / away\b/.test(statusLine())
}

/** The sidebar's columns at the current width. */
function listWidth(): number {
  return sidebarWidth(setup.renderer.width)
}

/** The conversation header: the line under the pane's top border. */
function paneTitle(): string {
  return frame().split('\n')[2]!.slice(listWidth())
}

function openedAt(id: string): number | null {
  return (getDb().query('SELECT opened_at FROM messages WHERE id = ?').get(id) as { opened_at: number | null }).opened_at
}

async function sentByTui() {
  return (await alice.read(identitySession.address, undefined, { confirmAvailability: false })).messages.filter(message => message.sender === identitySession.address)
}

test('shows and opens an incoming message while the terminal is focused', async () => {
  await start()
  const message = await alice.send(identitySession.address, 'hello terminal')
  await until(() => frame().includes('hello terminal'), 'message rendered')
  expect(openedAt(message.id)).not.toBeNull()
})

test('an unfocused terminal leaves messages unopened and lets push through; focus opens them', async () => {
  await start()
  savePushSubscription(identitySession.address, { endpoint: 'https://push.invalid/tui', p256dh: 'x', auth: 'y' })
  await alice.send(identitySession.address, 'while focused')
  await until(() => frame().includes('while focused'), 'focused message')
  expect(pushes).toBe(0)

  setup.renderer.emit('blur')
  await Bun.sleep(500) // attention settles, then reaches the server
  const away = await alice.send(identitySession.address, 'while away')
  await Bun.sleep(600)
  await setup.renderOnce()
  expect(pushes).toBe(1)
  expect(openedAt(away.id)).toBeNull()
  expect(frame()).not.toContain('while away')

  setup.renderer.emit('focus')
  await until(() => frame().includes('while away'), 'opened on focus')
  expect(openedAt(away.id)).not.toBeNull()
})

test('a terminal that never reports focus goes away when idle; a key press brings it back', async () => {
  await start(undefined, 32, 1000)
  savePushSubscription(identitySession.address, { endpoint: 'https://push.invalid/tui', p256dh: 'x', auth: 'y' })
  await until(() => shownAway(), 'idle', 3000)
  await Bun.sleep(500) // attention settles, then reaches the server
  await setup.mockInput.typeText(`/open ${alice.identity.address}`)
  setup.mockInput.pressEnter()
  await until(() => !shownAway(), 'typing counts as input')
  await until(() => shownAway(), 'idle again', 3000)
  await Bun.sleep(500)
  const away = await alice.send(identitySession.address, 'while idle')
  await Bun.sleep(600)
  await setup.renderOnce()
  expect(pushes).toBe(1)
  expect(openedAt(away.id)).toBeNull()
  expect(frame()).not.toContain('while idle')

  setup.mockInput.pressArrow('down')
  await until(() => frame().includes('while idle'), 'opened after a key press')
  expect(openedAt(away.id)).not.toBeNull()
})

test('a multi-line paste that starts with / is a message, and an unknown command keeps its text', async () => {
  await start()
  await setup.mockInput.pasteBracketedText('/usr/local/bin\nis on my PATH')
  setup.mockInput.pressEnter()
  await until(async () => (await sentByTui()).length === 1, 'pasted message sent')
  expect((await sentByTui())[0]!.plaintext).toBe('/usr/local/bin\nis on my PATH')

  await setup.mockInput.typeText('/tll 5m')
  setup.mockInput.pressEnter()
  await until(() => frame().includes('Unknown command /tll'), 'unknown command')
  expect(frame()).toContain('/tll 5m')
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
  await alice.send(identitySession.address, 'evil \x1b]52;c;UFdORUQ=\x07 abc‮dcba')
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
    const message = await alice.send(identitySession.address, 'from alice')
    await until(() => unreadShown(shortAddress(alice.identity.address)) === '1', 'unread marker')
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
    await until(() => unreadShown(shortAddress(alice.identity.address)) === null, 'read')
  } finally {
    await carol.close()
  }
})

test('/clear asks in a dialog: cancel keeps the messages, Delete clears for both', async () => {
  await start()
  await alice.send(identitySession.address, 'to be cleared')
  await until(() => frame().includes('to be cleared'), 'message rendered')
  await setup.mockInput.typeText('/clear')
  setup.mockInput.pressEnter()
  await until(() => frame().includes(' Clear conversation '), 'confirmation asked')
  setup.mockInput.pressEscape()
  await until(() => !frame().includes(' Clear conversation '), 'cancelled')
  expect(frame()).toContain('to be cleared')
  expect((await alice.read(identitySession.address)).messages).toHaveLength(1)

  await setup.mockInput.typeText('/clear')
  setup.mockInput.pressEnter()
  await until(() => frame().includes(' Clear conversation '), 'confirmation asked again')
  setup.mockInput.pressArrow('right')
  setup.mockInput.pressEnter()
  await until(() => !frame().includes('to be cleared'), 'conversation cleared')
  await until(() => frame().includes('Conversation cleared for both of you'), 'success toast')
  expect((await alice.read(identitySession.address)).messages).toHaveLength(0)
})

test('/help, F1 and ? in the list open Help; Esc gives the keys back', async () => {
  await start()
  await setup.mockInput.typeText('/help')
  setup.mockInput.pressEnter()
  await until(() => frame().includes(' Help '), 'help from /help')
  // Typing goes nowhere while Help is open.
  await setup.mockInput.typeText('x')
  setup.mockInput.pressEscape()
  await until(() => !frame().includes(' Help '), 'help closed')
  await setup.mockInput.typeText('hi')
  await setup.renderOnce()
  expect(frame()).toContain('hi')
  expect(frame()).not.toContain('xhi')

  setup.mockInput.pressKey('F1' as never)
  await until(() => frame().includes(' Help '), 'help from F1')
  setup.mockInput.pressEscape()
  await until(() => !frame().includes(' Help '), 'help closed again')

  setup.mockInput.pressTab()
  await setup.mockInput.typeText('?')
  await until(() => frame().includes(' Help '), 'help from ? in the list')
})

test('keys and clicks in an open dialog still count as attention', async () => {
  await start(undefined, 32, 1000)
  setup.mockInput.pressKey('F1' as never)
  await until(() => frame().includes(' Help '), 'help open')
  await until(() => shownAway(), 'idle', 3000)
  setup.mockInput.pressArrow('down')
  await until(() => !shownAway(), 'a key in the dialog counts')
  expect(frame()).toContain(' Help ')

  await until(() => shownAway(), 'idle again', 3000)
  const lines = frame().split('\n')
  const y = lines.findIndex(line => line.includes('Commands'))
  await setup.mockMouse.click(lines[y]!.indexOf('Commands'), y)
  await until(() => !shownAway(), 'a click in the dialog counts')
  expect(frame()).toContain(' Help ')
})

test('the status bar shows the server, lifetime and a compact address', async () => {
  await start()
  const line = statusLine()
  expect(line).toContain('● connected')
  expect(line).toContain(server.url.host)
  expect(line).toContain('lifetime 30m')
  expect(line).toContain(shortAddress(identitySession.address))
  expect(line).not.toContain(checksumAddress(identitySession.address))
})

test('the hint bar shows the keys of whatever has focus', async () => {
  await start()
  expect(hintLine()).toContain('Enter send')
  expect(hintLine()).toContain('F1 help')

  setup.mockInput.pressTab()
  await until(() => hintLine().includes('Enter open'), 'list hints')
  expect(hintLine()).toContain('↑↓ move')
  expect(hintLine()).not.toContain('Enter send')

  await setup.mockInput.typeText('?')
  await until(() => hintLine().includes('Esc close'), 'help dialog hints, above its backdrop')
  setup.mockInput.pressEscape()
  await until(() => hintLine().includes('Enter open'), 'list hints again')

  await setup.mockInput.typeText('\t/clear')
  setup.mockInput.pressEnter()
  await until(() => hintLine().includes('y delete'), 'confirm hints')
  setup.mockInput.pressEscape()
  await until(() => hintLine().includes('Enter send'), 'composer hints again')
})

test('a narrow terminal drops the least important hints first', async () => {
  await start()
  setup.resize(44, 32)
  await until(() => !hintLine().includes('Ctrl+C'), 'quit hint dropped')
  expect(hintLine()).toContain('Enter send')
  expect(hintLine()).toContain('F1 help')
  expect(statusLine()).toContain('● connected')
})

test('a lost connection counts down to the next attempt, then reconnects', async () => {
  await start()
  const port = server.port
  await server.stop(true)
  await until(() => /◐ reconnecting in \ds/.test(statusLine()), 'countdown', 4000)
  server = Bun.serve({ port, hostname: '127.0.0.1', fetch: createFetch() })
  await until(() => statusLine().includes('● connected'), 'reconnected', 8000)
}, 15_000)

test('command results and errors show as toasts that go away', async () => {
  await start()
  await setup.mockInput.typeText('/ttl 5m')
  setup.mockInput.pressEnter()
  await until(() => frame().includes('New messages disappear 5m'), 'lifetime toast')
  await until(() => !frame().includes('New messages disappear 5m'), 'toast expired', 6000)
}, 10_000)

test('an unregistered partner is reported and a failed send keeps its text', async () => {
  await start(generateKeypair().address)
  await until(() => frame().includes('not registered on this server'), 'unregistered notice')
  await setup.mockInput.typeText('nobody home')
  setup.mockInput.pressEnter()
  await until(() => frame().includes('Send failed'), 'send failure')
  expect(frame()).toContain('nobody home')
  await until(() => /nobody home\s+not sent · Enter resends ✗/.test(frame()), 'failed state on the message')
})

test('clicking a conversation in the list opens it', async () => {
  const carol = new ChatClient(server.url.origin, generateKeypair())
  await carol.login()
  try {
    await start(carol.identity.address)
    const message = await alice.send(identitySession.address, 'clicked open')
    await until(() => unreadShown(shortAddress(alice.identity.address)) === '1', 'alice listed')
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
  const target = addresses.find(address => frame().split('\n').some(line => line.slice(0, listWidth()).includes(shortAddress(address))) && address !== addresses[0])!
  await clickConversation(target)
  await until(() => paneTitle().includes(checksumAddress(target)), 'clicked conversation opened')
})

/** The column where `text` first appears, and its line. */
function locate(text: string): { line: number; column: number } {
  const lines = frame().split('\n')
  const line = lines.findIndex(candidate => candidate.includes(text))
  if (line < 0) throw new Error(`${text} is not on screen\n${frame()}`)
  return { line, column: lines[line]!.indexOf(text) }
}

/** The colour `text` is drawn in. */
function colorOf(text: string): number[] {
  for (const line of setup.captureSpans().lines) {
    const span = line.spans.find(candidate => candidate.text.includes(text))
    if (span) return span.fg.toInts()
  }
  throw new Error(`${text} is not on screen\n${frame()}`)
}

const ints = (hex: string) => RGBA.fromHex(hex).toInts()

/** Where the pane's left border is: the second ╭ on the line under the status bar, or 0 without a sidebar. */
function paneLeft(): number {
  const line = frame().split('\n')[1]!
  return line.indexOf('╭', 1) > 0 ? line.indexOf('╭', 1) : 0
}

test('your messages are on the right and theirs on the left, grouped under a day label', async () => {
  await start()
  await alice.send(identitySession.address, 'first from alice')
  await alice.send(identitySession.address, 'second from alice')
  await until(() => frame().includes('second from alice'), 'messages rendered')
  await setup.mockInput.typeText('reply from me')
  setup.mockInput.pressEnter()
  await until(() => /reply from me\s+unopened 24h ○/.test(frame()), 'sent and unopened')

  const middle = (listWidth() + 110) / 2
  expect(locate('first from alice').column).toBeLessThan(middle)
  expect(locate('reply from me').column).toBeGreaterThan(middle)
  expect(frame()).toContain('── Today ──')
  // Alice's two messages share one header; yours has its own.
  const pane = frame().split('\n').map(line => line.slice(listWidth()))
  expect(pane.filter(line => line.includes(shortAddress(alice.identity.address)))).toHaveLength(1)
  expect(pane.filter(line => / you\b/.test(line))).toHaveLength(1)
  const header = pane.findIndex(line => line.includes(shortAddress(alice.identity.address)))
  expect(pane[header + 1]).toContain('first from alice')

  // Once Alice opens it, it shows as opened with its lifetime.
  await alice.read(identitySession.address)
  await until(() => /reply from me\s+30m ✓/.test(frame()), 'opened state')
})

test('a divider marks what arrived while you were elsewhere, until you send', async () => {
  const carol = new ChatClient(server.url.origin, generateKeypair())
  await carol.login()
  try {
    await start(carol.identity.address)
    await alice.send(identitySession.address, 'while elsewhere')
    await until(() => unreadShown(shortAddress(alice.identity.address)) === '1', 'unread marker')
    await setup.mockInput.typeText(`/open ${alice.identity.address}`)
    setup.mockInput.pressEnter()
    await until(() => frame().includes('while elsewhere'), 'alice opened')
    expect(locate('── new ──').line).toBeLessThan(locate('while elsewhere').line)

    await setup.mockInput.typeText('got it')
    setup.mockInput.pressEnter()
    await until(() => !frame().includes('── new ──'), 'divider gone after sending')
    expect(frame()).toContain('while elsewhere')
  } finally {
    await carol.close()
  }
})

test('the divider still shows when the local clock is behind the server', async () => {
  const carol = new ChatClient(server.url.origin, generateKeypair())
  await carol.login()
  const realNow = Date.now.bind(Date)
  let behind: ReturnType<typeof spyOn> | undefined
  try {
    await start(carol.identity.address)
    await until(() => !frame().includes('Loading…'), 'carol synchronized')
    await alice.send(identitySession.address, 'sent before the clock drifted')
    await until(() => unreadShown(shortAddress(alice.identity.address)) === '1', 'unread marker')
    await setup.mockInput.typeText(`/open ${alice.identity.address}`)
    // Opening runs within Enter. Only the local clock falls behind there, not
    // the in-process server's, nor the open conversation's server time.
    behind = spyOn(Date, 'now').mockImplementation(() => realNow() - 60_000)
    setup.mockInput.pressEnter()
    behind.mockRestore()
    await until(() => frame().includes('sent before the clock drifted'), 'alice opened')
    expect(frame()).toContain('── new ──')
  } finally {
    behind?.mockRestore()
    await carol.close()
  }
})

test('at 60×20 the list and the conversation take turns on screen', async () => {
  await start(undefined, 20, undefined, { width: 60 })
  expect(frame()).toContain('← conversations')
  expect(frame()).not.toContain(' Conversations ')
  expect(paneLeft()).toBe(0)

  setup.mockInput.pressTab()
  await until(() => frame().includes(' Conversations '), 'list screen')
  expect(frame()).not.toContain('Write a message')
  // The list takes the whole width.
  expect(frame().split('\n')[1]!.trimEnd().length).toBe(60)
  expect(hintLine()).toContain('Enter open')

  setup.mockInput.pressEscape()
  await until(() => frame().includes('Write a message'), 'back to the conversation')
  expect(frame()).not.toContain(' Conversations ')
  setup.mockInput.pressKey('b', { ctrl: true })
  await until(() => frame().includes(' Conversations '), 'Ctrl+B switches screens too')
})

test('at 100×30 and 180×50 the sidebar scales, and Ctrl+B hides it', async () => {
  await start(undefined, 30, undefined, { width: 100 })
  expect(paneLeft()).toBe(sidebarWidth(100))
  expect(frame()).not.toContain('← conversations')

  setup.mockInput.pressKey('b', { ctrl: true })
  await until(() => paneLeft() === 0, 'sidebar hidden')
  expect(frame()).toContain('← conversations')
  setup.mockInput.pressKey('b', { ctrl: true })
  await until(() => paneLeft() === sidebarWidth(100), 'sidebar shown again')

  setup.resize(180, 50)
  await until(() => paneLeft() === sidebarWidth(180), 'wider sidebar')
  expect(sidebarWidth(180)).toBe(36)
  expect(sidebarWidth(100)).toBe(25)
})

test('resizing keeps focus, the draft and the scroll position', async () => {
  await start(undefined, 30, undefined, { width: 100 })
  for (let index = 1; index <= 30; index++) await alice.send(identitySession.address, `line ${index} of many`)
  await until(() => frame().includes('line 30 of many'), 'messages rendered')
  setup.mockInput.pressKey('\x1b[5~')
  await until(() => !frame().includes('line 30 of many'), 'scrolled up')
  const shown = frame().match(/line (\d+) of many/)![1]
  await setup.mockInput.typeText('half typed')

  setup.resize(60, 20)
  await until(() => frame().includes('← conversations'), 'collapsed')
  expect(frame()).not.toContain('line 30 of many')
  await setup.mockInput.typeText(' more')
  await until(() => frame().includes('half typed more'), 'composer kept focus')

  setup.resize(100, 30)
  await until(() => paneLeft() === sidebarWidth(100), 'expanded again')
  expect(frame()).toContain('half typed more')
  expect(frame()).not.toContain('line 30 of many')
  expect(frame()).toContain(`line ${shown} of many`)
}, 15_000)

test('the composer grows with its text up to eight lines', async () => {
  await start()
  const composerRows = () => {
    const lines = frame().split('\n')
    const bottom = lines.findLastIndex(line => line.includes('╰'))
    const top = lines.findLastIndex((line, index) => index < bottom && line.slice(listWidth()).includes('╭'))
    return bottom - top - 1
  }
  expect(composerRows()).toBe(1)
  await setup.mockInput.typeText('one')
  setup.mockInput.pressEnter({ meta: true })
  await setup.mockInput.typeText('two')
  setup.mockInput.pressEnter({ meta: true })
  await setup.mockInput.typeText('three')
  await until(() => composerRows() === 3, 'three lines')
  for (let index = 0; index < 8; index++) {
    setup.mockInput.pressEnter({ meta: true })
    await setup.mockInput.typeText(`more ${index}`)
  }
  await until(() => composerRows() === 8, 'capped at eight')
  setup.mockInput.pressEnter()
  await until(() => composerRows() === 1, 'back to one line after sending')
})

test('the palette follows the terminal under system, and /theme overrides it', async () => {
  await start()
  expect(colorOf('hushhash')).toEqual(ints(PALETTES.dark.accent))
  setup.renderer.emit('theme_mode', 'light')
  await until(() => colorOf('hushhash').join() === ints(PALETTES.light.accent).join(), 'light palette')
  expect(colorOf('Write a message')).toEqual(ints(PALETTES.light.muted))

  await setup.mockInput.typeText('/theme dark')
  setup.mockInput.pressEnter()
  await until(() => colorOf('hushhash').join() === ints(PALETTES.dark.accent).join(), 'dark despite the terminal')
  setup.renderer.emit('theme_mode', 'light')
  await setup.renderOnce()
  expect(colorOf('hushhash')).toEqual(ints(PALETTES.dark.accent))

  await setup.mockInput.typeText('/theme system')
  setup.mockInput.pressEnter()
  await until(() => colorOf('hushhash').join() === ints(PALETTES.light.accent).join(), 'following the terminal again')
})

test('an open dialog and toasts on screen repaint when the terminal theme changes', async () => {
  await start()
  await setup.mockInput.typeText('/theme')
  setup.mockInput.pressEnter()
  await until(() => frame().includes('Theme system.'), 'toast shown')
  setup.mockInput.pressKey('F1')
  await until(() => frame().includes(' Help '), 'help open')
  expect(colorOf(' Help ')).toEqual(ints(PALETTES.dark.accent))
  expect(colorOf('Theme system.')).toEqual(ints(PALETTES.dark.text))

  setup.renderer.emit('theme_mode', 'light')
  await until(() => colorOf(' Help ').join() === ints(PALETTES.light.accent).join(), 'dialog repainted')
  expect(colorOf('Commands')).toEqual(ints(PALETTES.light.text))
  expect(colorOf('Theme system.')).toEqual(ints(PALETTES.light.text))
})

test('--theme light starts in the light palette', async () => {
  await start(undefined, 32, undefined, { theme: 'light' })
  expect(colorOf('hushhash')).toEqual(ints(PALETTES.light.accent))
})

test('avatars show in the list, the header and the status bar where colours allow', async () => {
  await start(undefined, 32, undefined, { truecolor: true })
  await alice.send(identitySession.address, 'hi')
  await until(() => frame().includes(`▀▀▀▀ ${shortAddress(alice.identity.address)}`), 'avatar in the list')
  expect(frame()).toContain(`▀▀▀▀ ${checksumAddress(alice.identity.address)}`)
  expect(statusLine()).toContain(`▀▀▀▀ ${shortAddress(identitySession.address)}`)
})

test('a terminal without 256 colours shows no avatars', async () => {
  await start()
  expect(frame()).not.toContain('▀')
})

async function command(line: string) {
  await setup.mockInput.typeText(line)
  setup.mockInput.pressEnter()
  await setup.renderOnce()
}

test('r in the list names a conversation; the name shows in the list, header and transcript', async () => {
  await start()
  const short = shortAddress(alice.identity.address)
  await alice.send(identitySession.address, 'hello from alice')
  await until(() => frame().includes('hello from alice'), 'message rendered')
  setup.mockInput.pressTab()
  await setup.mockInput.typeText('r')
  await until(() => frame().includes(' Name conversation '), 'name prompt')
  await setup.mockInput.typeText('Alice\x1b]0;pwned\x07')
  setup.mockInput.pressEnter()
  await until(() => !frame().includes(' Name conversation '), 'prompt closed')
  await until(() => listRow('Alice') !== undefined, 'name in the list')
  // The short address moves to the second line.
  const lines = frame().split('\n')
  const row = lines.findIndex(line => line.slice(0, listWidth()).includes('Alice'))
  expect(lines[row + 1]!.slice(0, listWidth())).toContain(short)
  expect(paneTitle()).toContain('Alice')
  expect(paneTitle()).toContain(checksumAddress(alice.identity.address))
  const pane = frame().split('\n').map(line => line.slice(listWidth()))
  expect(pane[pane.findIndex(line => line.includes('hello from alice')) - 1]).toContain('Alice')
  // Control characters in a name are shown escaped, never sent to the terminal.
  expect(frame()).not.toContain('\x1b')

  await setup.mockInput.typeText('\t/name')
  setup.mockInput.pressEnter()
  await until(() => listRow('Alice') === undefined, 'name cleared')
  expect(listRow(short)).toBeDefined()
})

test('/open ADDRESS NAME names the conversation as it opens it', async () => {
  await start(undefined)
  await command(`/open ${alice.identity.address} Alice Liddell`)
  await until(() => paneTitle().includes('Alice Liddell'), 'named in the header')
  expect(listRow('Alice Liddell')).toBeDefined()
})

test('unread counts survive a restart; opening clears them only while attentive', async () => {
  const keypair = generateKeypair()
  const statePath = tempStatePath()
  const short = shortAddress(alice.identity.address)
  await start(null, 32, undefined, { keypair, statePath })
  await alice.send(keypair.address, 'one')
  await until(() => unreadShown(short) === '1', 'counted live')
  await quit()

  await alice.send(keypair.address, 'two')
  const third = await alice.send(keypair.address, 'three')
  await start(null, 32, undefined, { keypair, statePath })
  await until(() => unreadShown(short) === '3', 'counted after a restart')
  // Bold while unread.
  const name = setup.captureSpans().lines.flatMap(line => line.spans).find(span => span.text.includes(short))!
  expect(name.attributes & 1).toBe(1)

  // Opening it while away opens nothing, so it stays unread, also after a restart.
  setup.renderer.emit('blur')
  await until(() => shownAway(), 'away')
  app.open(alice.identity.address)
  await until(() => frame().includes('Away: new messages'), 'conversation open while away')
  await Bun.sleep(300)
  expect(openedAt(third.id)).toBeNull()
  expect(unreadShown(short)).toBe('3')
  await quit()

  await start(null, 32, undefined, { keypair, statePath })
  await until(() => unreadShown(short) === '3', 'still unread')
  setup.mockInput.pressTab()
  setup.mockInput.pressEnter()
  await until(() => frame().includes('three'), 'opened while attentive')
  await until(() => unreadShown(short) === null, 'read')
  await quit()

  await start(null, 32, undefined, { keypair, statePath })
  await until(() => listRow(short) !== undefined, 'listed')
  await Bun.sleep(300)
  await setup.renderOnce()
  expect(unreadShown(short)).toBeNull()
}, 20_000)

test('d removes a conversation from the list until a new message arrives, across a restart', async () => {
  const keypair = generateKeypair()
  const statePath = tempStatePath()
  const short = shortAddress(alice.identity.address)
  await start(null, 32, undefined, { keypair, statePath })
  await alice.send(keypair.address, 'before removing')
  await until(() => listRow(short) !== undefined, 'listed')
  await command(`/open ${alice.identity.address} Alice`)
  setup.mockInput.pressTab()
  await setup.mockInput.typeText('d')
  await until(() => frame().includes(' Remove conversation '), 'confirmation asked')
  expect(frame()).toContain('Its messages stay on the server')
  setup.mockInput.pressEscape()
  await until(() => !frame().includes(' Remove conversation '), 'cancelled')
  expect(listRow('Alice')).toBeDefined()

  await setup.mockInput.typeText('d')
  await until(() => frame().includes(' Remove conversation '), 'asked again')
  await setup.mockInput.typeText('y')
  await until(() => listRow('Alice') === undefined && listRow(short) === undefined, 'removed')
  // Not deleted on the server.
  expect((await alice.read(keypair.address, undefined, { confirmAvailability: false })).messages).toHaveLength(1)
  await quit()

  await start(null, 32, undefined, { keypair, statePath })
  await Bun.sleep(300)
  await setup.renderOnce()
  expect(listRow(short)).toBeUndefined()

  await alice.send(keypair.address, 'after removing')
  // Back, unnamed, and counting only what came after the removal.
  await until(() => unreadShown(short) === '1', 'back with new activity')
  expect(listRow('Alice')).toBeUndefined()
}, 15_000)

test('/remove closes the open conversation', async () => {
  await start()
  await command('/remove')
  await until(() => frame().includes(' Remove conversation '), 'confirmation asked')
  await setup.mockInput.typeText('y')
  await until(() => frame().includes('then start a conversation'), 'conversation closed')
  expect(listRow(shortAddress(alice.identity.address))).toBeUndefined()
  expect(hintLine()).toContain('Enter open')
})

/** The Share panel is open: its keys are in the hint bar. */
function shareOpen(): boolean {
  return hintLine().includes('l copy link')
}

/** Stands in for the terminal's clipboard; `supported: false` is a terminal without OSC 52. */
function clipboard(supported = true): string[] {
  const copied: string[] = []
  spyOn(setup.renderer, 'copyToClipboardOSC52').mockImplementation(text => {
    if (supported) copied.push(text)
    return supported
  })
  return copied
}

test('/share shows a QR code, the address and the link, and copies them', async () => {
  await start(null, 40)
  const copied = clipboard()
  const link = `${server.url.origin}/chat/${checksumAddress(identitySession.address)}`
  await command('/share')
  await until(() => shareOpen(), 'share open')
  expect(frame()).toContain(checksumAddress(identitySession.address))
  expect(frame()).toContain(link)
  expect(frame()).toContain('█')
  expect(hintLine()).toContain('c copy address')
  expect(hintLine()).toContain('l copy link')

  setup.mockInput.pressKey('c')
  await until(() => frame().includes('Address copied'), 'address copied')
  setup.mockInput.pressKey('l')
  await until(() => frame().includes('Link copied'), 'link copied')
  expect(copied).toEqual([checksumAddress(identitySession.address), link])

  setup.mockInput.pressEscape()
  await until(() => !shareOpen(), 'share closed')
  // /address is the same panel, and so is s in the list.
  await command('/address')
  await until(() => shareOpen(), 'share from /address')
  setup.mockInput.pressEscape()
  await until(() => !shareOpen(), 'closed again')
  setup.mockInput.pressTab()
  setup.mockInput.pressKey('s')
  await until(() => shareOpen(), 'share from s in the list')
})

test('Share says how large the terminal must be for the QR code, and when copying is not possible', async () => {
  await start(null, 24)
  clipboard(false)
  await command('/share')
  await until(() => shareOpen(), 'share open')
  expect(frame()).not.toContain('█')
  expect(frame()).toMatch(/Make the terminal at least \d+×\d+ to show the QR code/)
  setup.mockInput.pressKey('c')
  await until(() => frame().includes('This terminal cannot copy'), 'copy refused')
})

test('/key hides the key until v, and hides it again on closing or looking away', async () => {
  const keypair = generateKeypair()
  const secret = keypair.privateKey
  const logged = (['log', 'info', 'warn', 'error', 'debug'] as const).map(method => spyOn(console, method))
  await start(null, 32, undefined, { keypair, identityPath: '/home/someone/.config/hushhash/identity.json' })
  const copied = clipboard()
  await command('/key')
  await until(() => frame().includes(' Your key '), 'key open')
  expect(frame()).toContain(checksumAddress(keypair.address))
  expect(frame()).toContain('/home/someone/.config/hushhash/identity.json')
  expect(frame()).toContain('never import a key from a crypto wallet')
  expect(frame()).toContain(HIDDEN_KEY)
  expect(frame()).not.toContain(secret)

  setup.mockInput.pressKey('v')
  await until(() => frame().includes(secret), 'revealed')
  setup.mockInput.pressKey('v')
  await until(() => !frame().includes(secret), 'v hides it again')
  setup.mockInput.pressKey('v')
  await until(() => frame().includes(secret), 'revealed again')
  setup.mockInput.pressEscape()
  await until(() => !frame().includes(' Your key '), 'closed')
  await command('/key')
  await until(() => frame().includes(' Your key '), 'reopened')
  expect(frame()).toContain(HIDDEN_KEY)
  expect(frame()).not.toContain(secret)

  setup.mockInput.pressKey('v')
  await until(() => frame().includes(secret), 'revealed before looking away')
  setup.renderer.emit('blur')
  await until(() => !frame().includes(secret), 'hidden on blur')
  expect(frame()).toContain(' Your key ')

  setup.mockInput.pressKey('c')
  await until(() => frame().includes('Private key copied'), 'copied')
  expect(copied).toEqual([secret])
  for (const spy of logged) {
    expect(spy.mock.calls.flat().some(argument => String(argument).includes(secret.slice(2)))).toBe(false)
    spy.mockRestore()
  }
})

test('links in messages are underlined, and clickable where the terminal supports hyperlinks', async () => {
  await start(undefined, 32, undefined, { hyperlinks: true })
  await alice.send(identitySession.address, 'read https://example.com/page. thanks')
  await until(() => frame().includes('https://example.com/page'), 'message shown')
  const lines = frame().split('\n')
  const y = lines.findIndex(line => line.includes('https://example.com/page'))
  const x = lines[y]!.indexOf('https://example.com/page')
  expect(setup.renderer.getLinkAt(x + 3, y)).toBe('https://example.com/page')
  // The full stop after it is not part of it.
  expect(setup.renderer.getLinkAt(x + 'https://example.com/page'.length, y)).toBeNull()
  expect(setup.renderer.getLinkAt(x - 2, y)).toBeNull()
})
