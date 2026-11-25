import { expect, test } from 'bun:test'
import { parseLifetime } from './lifetime'

test('parses lifetimes as seconds or labels', () => {
  expect(parseLifetime('300')).toBe(300)
  expect(parseLifetime('0300')).toBe(300)
  expect(parseLifetime('5m')).toBe(300)
  expect(parseLifetime('24H')).toBe(86400)
  expect(parseLifetime('7')).toBeNull()
  expect(parseLifetime('forever')).toBeNull()
})
