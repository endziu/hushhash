import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { initDb, getDb } from '../../src/server/db'
import { createFetch } from '../../src/server/router'
import * as limiters from '../../src/server/rate-limiters'
import * as constants from '../../src/server/constants'
import { generateKeypair } from '../../src/shared/keypair'
import { IdentitySession, type LiveStatus } from './identity-session'

let server: ReturnType<typeof Bun.serve>
let logging: ReturnType<typeof spyOn>

beforeEach(() => {
  initDb(':memory:')
  for (const limiter of Object.values(limiters)) limiter.reset()
  logging = spyOn(constants, 'log').mockImplementation(() => {})
  server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: createFetch() })
})

afterEach(async () => {
  await server.stop(true)
  logging.mockRestore()
  getDb().close()
})

test('live reports when the next attempt starts, and a retry stays retrying', async () => {
  const session = new IdentitySession(server.url.origin, generateKeypair())
  await session.login()
  const statuses: LiveStatus[] = []
  void session.live({ event: () => {}, connection: () => {}, status: status => statuses.push(status) })
  const until = async (check: () => boolean) => { while (!check()) await Bun.sleep(20) }
  await until(() => statuses.some(status => status.state === 'connected'))
  expect(statuses.map(status => status.state)).toEqual(['connecting', 'connected'])

  await server.stop(true)
  const failed = () => statuses.filter(status => status.state === 'retrying')
  await until(() => failed().length >= 2)
  session.abort()
  expect(statuses.slice(2).map(status => status.state)).toEqual(['retrying', 'retrying'])
  const [first, second] = failed() as Extract<LiveStatus, { state: 'retrying' }>[]
  expect(second!.failures).toBe(first!.failures + 1)
  expect(second!.retryAt - first!.retryAt).toBeGreaterThanOrEqual(2000)
  expect(first!.reason).not.toBe('')
}, 8000)
