import { afterAll, afterEach, beforeAll, beforeEach, expect, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { render } from 'preact'
import { initDb } from '../../server/db'
import { createFetch } from '../../server/router'
import * as limiters from '../../server/rate-limiters'
import * as serverConstants from '../../server/constants'

// The app talks to the real request handler; a test fails chosen API paths to
// check what the user sees when start-up or sign-in goes wrong.
const BUN_GLOBALS = ['fetch', 'Request', 'Response', 'Headers', 'URL', 'URLSearchParams', 'ReadableStream',
  'WritableStream', 'TransformStream', 'TextEncoder', 'TextDecoder', 'AbortController', 'AbortSignal',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'performance', 'structuredClone']
const bunGlobals = new Map(BUN_GLOBALS.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
const bunFetch = globalThis.fetch

let App: typeof import('./App').App
let handler: ReturnType<typeof createFetch>
let container: HTMLElement
let failing: (path: string) => boolean
let requests: string[]
let consoleError: ReturnType<typeof spyOn>
let serverLog: ReturnType<typeof spyOn>

beforeAll(async () => {
  GlobalRegistrator.register({ url: 'http://localhost' })
  for (const [key, descriptor] of bunGlobals) if (descriptor) Object.defineProperty(globalThis, key, descriptor)
  App = (await import('./App')).App
})
afterAll(() => GlobalRegistrator.unregister())

beforeEach(() => {
  initDb(':memory:')
  for (const limiter of Object.values(limiters)) limiter.reset()
  handler = createFetch()
  localStorage.clear()
  failing = () => false
  requests = []
  consoleError = spyOn(console, 'error').mockImplementation(() => {})
  serverLog = spyOn(serverConstants, 'log').mockImplementation(() => {})
  globalThis.fetch = Object.assign(async (input: string | URL | Request, options?: RequestInit) => {
    const path = new URL(String(input), 'http://localhost').pathname
    requests.push(path)
    if (failing(path)) return Response.json({ error: 'Service unavailable' }, { status: 503 })
    const request = new Request(new URL(String(input), 'http://localhost'), options)
    return handler(request, { requestIP: () => ({ address: '127.0.0.1' }) })
  }, { preconnect: bunFetch.preconnect })
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  render(null, container)
  container.remove()
  consoleError.mockRestore()
  serverLog.mockRestore()
  globalThis.fetch = bunFetch
})

async function settle(ms = 150) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

test('a failed first registration shows the error and a Retry button', async () => {
  failing = path => path.startsWith('/api/pubkey/')
  render(<App />, container)
  await settle()

  expect(container.textContent).toContain('Service unavailable')
  expect(container.textContent).not.toContain('Connecting...')
  expect([...container.querySelectorAll('button')].some(button => button.textContent === 'Retry')).toBe(true)
})

test('a failed sign-in is shown once and not retried on its own', async () => {
  failing = path => path === '/api/auth/session'
  render(<App />, container)
  await settle(400)

  expect(container.textContent).toContain('Service unavailable')
  expect(requests.filter(path => path === '/api/auth/session')).toHaveLength(1)
})
