import { expect, test } from 'bun:test'
import { generateKeypair } from '../../src/shared/keypair'
import { shortAddress } from '../../src/shared/address'
import { detailText, fitText, listItemAt } from './sidebar'

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

test('fits text to a width with an ellipsis, by columns', () => {
  expect(fitText('Alice', 5)).toBe('Alice')
  expect(fitText('Alice Liddell', 8)).toBe('Alice L…')
  expect(fitText('名前の長い人', 5)).toBe('名前…')
  expect(fitText('anything', 0)).toBe('')
})

test('a named conversation shows its short address under the name, and the time when it fits', () => {
  const address = generateKeypair().address
  const short = shortAddress(address)
  expect(detailText({ address, last_message_at: null, name: null, badge: null }, 30)).toBe('new')
  expect(detailText({ address, last_message_at: null, name: 'Bob', badge: null }, 30)).toBe(`${short} · new`)
  expect(detailText({ address, last_message_at: null, name: 'Bob', badge: null }, 14)).toBe(short)
})
