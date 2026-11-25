import { expect, test } from 'bun:test'
import { generateKeypair } from '../../src/shared/keypair'
import { Commands, classifyInput, type CommandHost, type CommandSession } from './commands'
import { HELP_MODAL } from './help'
import type { ModalOptions } from './modals'
import type { ThemeSetting } from './theme'
import type { ToastKind } from './toasts'

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
  const state = {
    ttl: 1800,
    theme: 'system' as ThemeSetting,
    toasts: [] as { text: string; kind: ToastKind }[],
    modals: [] as ModalOptions[],
    confirmAnswer: true,
    confirms: 0,
    opened: [] as string[],
    quit: false,
  }
  const host: CommandHost = {
    address: generateKeypair().address,
    session: () => session,
    ttl: () => state.ttl,
    setTtl: seconds => { state.ttl = seconds },
    theme: () => state.theme,
    setTheme: setting => { state.theme = setting },
    open: address => { state.opened.push(address) },
    toast: (text, kind = 'info') => { state.toasts.push({ text, kind }) },
    modal: async options => { state.modals.push(options) },
    confirm: async () => { state.confirms++; return state.confirmAnswer },
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
  expect(state.toasts.at(-1)).toEqual({ text: expect.stringMatching(/^Lifetime 30m\./), kind: 'info' })
  commands.run('/ttl forever')
  expect(state.toasts.at(-1)?.kind).toBe('error')
  expect(state.ttl).toBe(1800)
  commands.run('/ttl 5m')
  expect(state.ttl).toBe(300)
  expect(state.toasts.at(-1)?.kind).toBe('success')
})

test('/theme shows, validates and sets the theme', () => {
  const { host, state } = fakeHost()
  const commands = new Commands(host)
  commands.run('/theme')
  expect(state.toasts.at(-1)).toEqual({ text: 'Theme system. Choose: system, light, dark', kind: 'info' })
  commands.run('/theme sepia')
  expect(state.toasts.at(-1)?.kind).toBe('error')
  expect(state.theme).toBe('system')
  commands.run('/theme light')
  expect(state.theme).toBe('light')
  expect(state.toasts.at(-1)).toEqual({ text: 'Theme light', kind: 'success' })
})

test('an unknown command reports false so its text can be kept', () => {
  const { host, state } = fakeHost()
  expect(new Commands(host).run('/tll 5m')).toBe(false)
  expect(state.toasts).toEqual([{ text: expect.stringContaining('Unknown command /tll'), kind: 'error' }])
})

test('/open needs a valid address', () => {
  const { host, state } = fakeHost()
  const commands = new Commands(host)
  commands.run('/open nope')
  expect(state.toasts.at(-1)).toEqual({ text: 'Usage: /open 0xADDRESS', kind: 'error' })
  const address = generateKeypair().address
  commands.run(`/new ${address}`)
  expect(state.opened).toEqual([address])
})

test('/clear deletes only once confirmed', async () => {
  const session = fakeSession()
  const { host, state } = fakeHost(session)
  const commands = new Commands(host)
  state.confirmAnswer = false
  commands.run('/clear')
  await Bun.sleep(0)
  expect(state.confirms).toBe(1)
  expect(session.cleared).toBe(0)

  state.confirmAnswer = true
  commands.run('/clear')
  await Bun.sleep(0)
  expect(session.cleared).toBe(1)
  expect(state.toasts.at(-1)).toEqual({ text: 'Conversation cleared for both of you', kind: 'success' })
})

test('/clear does nothing if another conversation opened while it asked', async () => {
  const first = fakeSession()
  let session: CommandSession = first
  let answer!: (yes: boolean) => void
  const { host } = fakeHost()
  const commands = new Commands({
    ...host,
    session: () => session,
    confirm: () => new Promise(resolve => { answer = resolve }),
  })
  commands.run('/clear')
  session = fakeSession()
  answer(true)
  await Bun.sleep(0)
  expect(first.cleared).toBe(0)
})

test('/clear reports a failure', async () => {
  const session = fakeSession()
  session.clear = async () => { throw new Error('offline') }
  const { host, state } = fakeHost(session)
  new Commands(host).run('/clear')
  await Bun.sleep(0)
  expect(state.toasts.at(-1)).toEqual({ text: 'Clear failed: offline', kind: 'error' })
})

test('/clear without a conversation asks to open one', () => {
  const { host, state } = fakeHost(null)
  new Commands(host).run('/clear')
  expect(state.confirms).toBe(0)
  expect(state.toasts).toEqual([{ text: 'Open a conversation first', kind: 'error' }])
})

test('/help and /address open modals; /retry retries what failed', () => {
  const session = fakeSession()
  const { host, state } = fakeHost(session)
  const commands = new Commands(host)
  commands.run('/help')
  commands.run('/address')
  expect(state.modals[0]).toBe(HELP_MODAL)
  expect(state.modals[1]?.title).toBe('Your address')

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
