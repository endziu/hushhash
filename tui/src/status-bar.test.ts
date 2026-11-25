import { expect, test } from 'bun:test'
import { t } from '@opentui/core'
import { fitBar } from './bar'
import { OFFLINE_AFTER, connectionText, serverLabel } from './status-bar'

const plain = (text: { chunks: { text: string }[] }) => text.chunks.map(chunk => chunk.text).join('')

test('the reconnect countdown is computed from the retry time', () => {
  const retrying = { state: 'retrying' as const, reason: 'HTTP 503', retryAt: 10_000, failures: 1 }
  expect(plain(connectionText(retrying, 6_000))).toBe('◐ reconnecting in 4s')
  expect(plain(connectionText(retrying, 6_500))).toBe('◐ reconnecting in 4s')
  expect(plain(connectionText(retrying, 7_000))).toBe('◐ reconnecting in 3s')
  expect(plain(connectionText(retrying, 10_000))).toBe('◐ reconnecting now')
  expect(plain(connectionText({ ...retrying, failures: OFFLINE_AFTER }, 6_000))).toBe('○ offline · retrying in 4s')
  expect(plain(connectionText({ state: 'connected' }, 0))).toBe('● connected')
  expect(plain(connectionText({ state: 'connecting' }, 0))).toBe('◐ connecting…')
})

test('servers are named prod, local, or by host', () => {
  expect(serverLabel('https://hushhash.org')).toBe('prod')
  expect(serverLabel('http://localhost:3000')).toBe('local')
  expect(serverLabel('https://chat.example.com')).toBe('chat.example.com')
})

test('a bar drops the least important items first and keeps the order', () => {
  const items = [
    { text: t`aaaa`, priority: 0 },
    { text: t`bbbb`, priority: 2 },
    { text: t`cccc`, priority: 1 },
    { text: t`dddd`, priority: 2 },
  ]
  const fit = (width: number) => plain(fitBar(items, width, t`${' '}`))
  expect(fit(19)).toBe('aaaa bbbb cccc dddd')
  expect(fit(18)).toBe('aaaa bbbb cccc')
  expect(fit(13)).toBe('aaaa cccc')
  expect(fit(8)).toBe('aaaa')
  expect(fit(3)).toBe('')
})
