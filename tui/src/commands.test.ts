import { expect, test } from 'bun:test'
import { generateKeypair } from '../../src/shared/keypair'
import { Commands, classifyInput, type CommandHost, type CommandSession } from './commands'
import { HELP } from './help'

function fakeSession(): CommandSession & { cleared: number; retried: string[] } {
  return {
    cleared: 0,
    retried: [],
    snapshot: () => ({ openingFailed: false }),
    retry() { this.retried.push('retry') },
    retryOpening() { this.retried.push('opening') },
    fetchOlder: async () => {},
    async clear() { this.cleared++ },
  }
}

function fakeHost(session: CommandSession | null = fakeSession()) {
  const state = { ttl: 1800, shown: null as { text: string; error: boolean } | null, opened: [] as string[], quit: false }
  const host: CommandHost = {
    address: generateKeypair().address,
    session: () => session,
    ttl: () => state.ttl,
    setTtl: seconds => { state.ttl = seconds },
    open: address => { state.opened.push(address) },
    shown: () => state.shown?.text ?? null,
    show: (text, error = false) => { state.shown = { text, error } },
    dismiss: () => { state.shown = null },
    toggleLog: () => {},
    quit: () => { state.quit = true },
  }
  return { host, state }
}

test('classifies composer input', () => {
  expect(classifyInput('  \n ')).toEqual({ type: 'empty' })
  expect(classifyInput(' hello ')).toEqual({ type: 'message', text: ' hello ' })
  expect(classifyInput('/ttl 5m ')).toEqual({ type: 'command', line: '/ttl 5m' })
  expect(classifyInput('//shrug')).toEqual({ type: 'message', text: '/shrug' })
  // Only one line can be a command or use the escape.
  expect(classifyInput('/usr/bin\nis here')).toEqual({ type: 'message', text: '/usr/bin\nis here' })
  expect(classifyInput('//a\nb')).toEqual({ type: 'message', text: '//a\nb' })
})

test('/ttl shows, validates and sets the lifetime', () => {
  const { host, state } = fakeHost()
  const commands = new Commands(host)
  expect(commands.run('/ttl')).toBe(true)
  expect(state.shown?.text).toStartWith('Lifetime 30m.')
  commands.run('/ttl forever')
  expect(state.shown?.error).toBe(true)
  expect(state.ttl).toBe(1800)
  commands.run('/ttl 5m')
  expect(state.ttl).toBe(300)
})

test('an unknown command reports false so its text can be kept', () => {
  const { host, state } = fakeHost()
  expect(new Commands(host).run('/tll 5m')).toBe(false)
  expect(state.shown).toEqual({ text: expect.stringContaining('Unknown command /tll'), error: true })
})

test('/open needs a valid address', () => {
  const { host, state } = fakeHost()
  const commands = new Commands(host)
  commands.run('/open nope')
  expect(state.shown?.text).toBe('Usage: /open 0xADDRESS')
  const address = generateKeypair().address
  commands.run(`/new ${address}`)
  expect(state.opened).toEqual([address])
})

test('/clear deletes only when typed again within 10 seconds for the same conversation', async () => {
  let now = 0
  const first = fakeSession()
  let session: CommandSession = first
  const { host } = fakeHost()
  const commands = new Commands({ ...host, session: () => session }, () => now)
  commands.run('/clear')
  now = 10_001
  commands.run('/clear')
  expect(first.cleared).toBe(0)
  now += 10_000
  commands.run('/clear')
  expect(first.cleared).toBe(1)

  // Opening a conversation makes a new session, which starts over.
  commands.run('/clear')
  const second = fakeSession()
  session = second
  commands.run('/clear')
  expect(first.cleared).toBe(1)
  expect(second.cleared).toBe(0)
  commands.run('/clear')
  expect(second.cleared).toBe(1)
})

test('/clear without a conversation asks to open one', () => {
  const { host, state } = fakeHost(null)
  new Commands(host).run('/clear')
  expect(state.shown).toEqual({ text: 'Open a conversation first', error: true })
})

test('/help toggles and /retry retries what failed', () => {
  const session = fakeSession()
  const { host, state } = fakeHost(session)
  const commands = new Commands(host)
  commands.run('/help')
  expect(state.shown?.text).toBe(HELP)
  commands.run('/help')
  expect(state.shown).toBeNull()

  commands.run('/retry')
  session.snapshot = () => ({ openingFailed: true })
  commands.run('/retry')
  expect(session.retried).toEqual(['retry', 'opening'])
})

test('/quit and /exit quit', () => {
  const { host, state } = fakeHost()
  new Commands(host).run('/exit')
  expect(state.quit).toBe(true)
})
