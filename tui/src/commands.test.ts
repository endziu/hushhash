import { expect, test } from 'bun:test'
import { generateKeypair } from '../../src/shared/keypair'
import type { Address } from '../../src/shared/address'
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
    notify: true,
    toasts: [] as { text: string; kind: ToastKind }[],
    modals: [] as ModalOptions[],
    confirmAnswer: true,
    confirms: 0,
    opened: [] as string[],
    partner: null as Address | null,
    names: [] as [Address, string][],
    removed: [] as Address[],
    quit: false,
    shared: 0,
    keys: 0,
    picks: 0,
  }
  const host: CommandHost = {
    session: () => session,
    ttl: () => state.ttl,
    setTtl: seconds => { state.ttl = seconds },
    pickLifetime: () => { state.picks++ },
    theme: () => state.theme,
    setTheme: setting => { state.theme = setting; return null },
    notifications: () => state.notify,
    setNotifications: on => { state.notify = on },
    partner: () => state.partner,
    open: address => { state.opened.push(address); state.partner = address },
    rename: (address, name) => { state.names.push([address, name]) },
    remove: async address => { state.removed.push(address) },
    toast: (text, kind = 'info') => { state.toasts.push({ text, kind }) },
    share: () => { state.shared++ },
    showKey: () => { state.keys++ },
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

test('/ttl opens the picker, validates and sets the lifetime', () => {
  const { host, state } = fakeHost()
  const commands = new Commands(host)
  expect(commands.run('/ttl')).toBe(true)
  expect(state.picks).toBe(1)
  expect(state.toasts).toEqual([])
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
  expect(state.toasts.at(-1)).toEqual({ text: 'Theme system. Choose: system, omarchy, light, dark', kind: 'info' })
  commands.run('/theme sepia')
  expect(state.toasts.at(-1)?.kind).toBe('error')
  expect(state.theme).toBe('system')
  commands.run('/theme light')
  expect(state.theme).toBe('light')
  expect(state.toasts.at(-1)).toEqual({ text: 'Theme light', kind: 'success' })
})

test('/notify shows, validates and sets desktop notifications', () => {
  const { host, state } = fakeHost()
  const commands = new Commands(host)
  commands.run('/notify')
  expect(state.toasts.at(-1)).toEqual({ text: 'Notifications on. Choose: on, off', kind: 'info' })
  commands.run('/notify maybe')
  expect(state.toasts.at(-1)?.kind).toBe('error')
  expect(state.notify).toBe(true)
  commands.run('/notify OFF')
  expect(state.notify).toBe(false)
  expect(state.toasts.at(-1)).toEqual({ text: 'Notifications off', kind: 'success' })
  commands.run('/notify on')
  expect(state.notify).toBe(true)
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
  expect(state.toasts.at(-1)).toEqual({ text: 'Usage: /open 0xADDRESS [NAME]', kind: 'error' })
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

test('/help opens help, /share and /address share, /key shows the key; /retry retries what failed', () => {
  const session = fakeSession()
  const { host, state } = fakeHost(session)
  const commands = new Commands(host)
  commands.run('/help')
  expect(state.modals).toEqual([HELP_MODAL])
  commands.run('/share')
  commands.run('/address')
  expect(state.shared).toBe(2)
  commands.run('/key')
  expect(state.keys).toBe(1)

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

test('/open names the conversation it opens; /name renames and clears the open one', () => {
  const { host, state } = fakeHost()
  const commands = new Commands(host)
  const address = generateKeypair().address
  commands.run('/name Bob')
  expect(state.toasts.at(-1)).toEqual({ text: 'Open a conversation first', kind: 'error' })
  commands.run(`/open ${address} Bob   the builder`)
  expect(state.opened).toEqual([address])
  expect(state.names).toEqual([[address, 'Bob the builder']])
  commands.run('/name Robert')
  commands.run('/name')
  expect(state.names.slice(1)).toEqual([[address, 'Robert'], [address, '']])
  commands.run(`/open ${address}`)
  expect(state.names).toHaveLength(3)
})

test('/remove removes the open conversation', () => {
  const { host, state } = fakeHost()
  const commands = new Commands(host)
  commands.run('/remove')
  expect(state.removed).toEqual([])
  const address = generateKeypair().address
  commands.run(`/open ${address}`)
  commands.run('/remove')
  expect(state.removed).toEqual([address])
})
