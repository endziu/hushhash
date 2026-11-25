import { expect, test } from 'bun:test'
import { OFFLINE_AFTER, connectionText } from './status-bar'

const plain = (text: { chunks: { text: string }[] }) => text.chunks.map(chunk => chunk.text).join('')

test('the reconnect countdown is computed from the retry time', () => {
  const retrying = { state: 'retrying' as const, reason: 'HTTP 503', retryAt: 10_000, failures: 1 }
  expect(plain(connectionText(retrying, 6_000))).toBe('◐ reconnecting in 4s')
  expect(plain(connectionText(retrying, 6_500))).toBe('◐ reconnecting in 4s')
  expect(plain(connectionText(retrying, 7_000))).toBe('◐ reconnecting in 3s')
  expect(plain(connectionText(retrying, 10_000))).toBe('◐ reconnecting…')
  expect(plain(connectionText({ state: 'connected' }, 0))).toBe('● connected')
  expect(plain(connectionText({ state: 'connecting' }, 0))).toBe('◐ connecting…')
})

test('after several failures in a row the connection shows as offline, also while retrying', () => {
  const offline = { state: 'retrying' as const, reason: 'HTTP 503', retryAt: 10_000, failures: OFFLINE_AFTER }
  expect(plain(connectionText(offline, 6_000))).toBe('○ offline · retrying in 4s')
  expect(plain(connectionText(offline, 11_000))).toBe('○ offline · retrying…')
})
