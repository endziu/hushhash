import { expect, test } from 'bun:test'
import { listItemAt } from './sidebar'

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
