import { expect, test } from 'bun:test'
import type { Address } from '../../src/shared/address'
import { filterConversations, matchConversations, matchScore } from './switcher'

const ALICE = '0xa11ce00000000000000000000000000000004d2f' as Address
const BOB = '0xb0b0000000000000000000000000000000001234' as Address
const CAROL = '0xca401000000000000000000000000000000beef1' as Address

const entries = [
  { address: BOB, name: 'Bob Builder' },
  { address: ALICE, name: 'Alice' },
  { address: CAROL, name: null },
]

function names(query: string): (string | null)[] {
  return matchConversations(query, entries).map(entry => entry.name ?? entry.address)
}

test('an empty query keeps every conversation in order', () => {
  expect(names('')).toEqual(['Bob Builder', 'Alice', CAROL])
  expect(names('   ')).toEqual(['Bob Builder', 'Alice', CAROL])
})

test('names match from the start, from a word, anywhere or by letters in order, ignoring case', () => {
  expect(names('ALI')).toEqual(['Alice'])
  expect(names('build')).toEqual(['Bob Builder'])
  expect(names('lic')).toEqual(['Alice'])
  expect(names('bbr')).toEqual(['Bob Builder'])
  expect(matchScore('al', { address: ALICE, name: 'Alice' })).toBeLessThan(matchScore('lic', { address: ALICE, name: 'Alice' })!)
})

test('addresses match from the start with or without 0x, or anywhere without it', () => {
  expect(names('0xA11C')).toEqual(['Alice'])
  expect(names('ca40')).toEqual([CAROL])
  expect(names('beef')).toEqual([CAROL])
  expect(names('0x')).toEqual(['Bob Builder', 'Alice', CAROL])
  // 0x anchors at the start, and letters in order never match an address.
  expect(names('0xbeef')).toEqual([])
  expect(names('cbf')).toEqual([])
})

test('better matches come first; equal ones keep their order', () => {
  // A name's start beats an address's.
  const both = [{ address: CAROL, name: null }, { address: BOB, name: 'ca' }]
  expect(matchConversations('ca', both).map(entry => entry.address)).toEqual([BOB, CAROL])
  expect(names('b')).toEqual(['Bob Builder', CAROL])
})

test('filtering keeps the list order', () => {
  const both = [{ address: CAROL, name: null }, { address: BOB, name: 'ca' }]
  expect(filterConversations('ca', both).map(entry => entry.address)).toEqual([CAROL, BOB])
  expect(filterConversations('zz', both)).toEqual([])
})
