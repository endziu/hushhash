import { expect, test } from 'bun:test'
import { listItemAt, parseLifetime } from './app'

test('parses lifetimes as seconds or labels', () => {
  expect(parseLifetime('300')).toBe(300)
  expect(parseLifetime('0300')).toBe(300)
  expect(parseLifetime('5m')).toBe(300)
  expect(parseLifetime('24H')).toBe(86400)
  expect(parseLifetime('7')).toBeNull()
  expect(parseLifetime('forever')).toBeNull()
})

test('maps list rows to items, following the list scroll', () => {
  // 10 rows show 5 two-row items.
  expect(listItemAt(0, 10, 3, 0)).toBe(0)
  expect(listItemAt(1, 10, 3, 0)).toBe(0)
  expect(listItemAt(5, 10, 3, 0)).toBe(2)
  expect(listItemAt(6, 10, 3, 0)).toBeNull()
  // Selecting item 7 of 9 scrolls the list to start at item 4.
  expect(listItemAt(0, 10, 9, 7)).toBe(4)
  expect(listItemAt(9, 10, 9, 7)).toBe(8)
  expect(listItemAt(-1, 10, 9, 7)).toBeNull()
})
