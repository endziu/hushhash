import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateKeypair } from '../../src/shared/keypair'
import { NAME_MAX_LENGTH, TuiState, cleanName, statePath } from './state'

let directory: string
let path: string
const self = generateKeypair().address
const bob = generateKeypair().address

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'hushhash-tui-state-'))
  path = join(directory, 'tui-state.json')
})

afterEach(() => rmSync(directory, { recursive: true, force: true }))

test('the state file sits beside the identity file', () => {
  expect(statePath('/home/me/.config/hushhash/identity.json')).toBe('/home/me/.config/hushhash/tui-state.json')
})

test('names, last-seen and removals survive a reload, in a private file', () => {
  const state = TuiState.load(path, self)
  state.setName(bob, '  Bob  ')
  state.markSeen(bob, 2000)
  const reloaded = TuiState.load(path, self)
  expect(reloaded.name(bob)).toBe('Bob')
  expect(reloaded.lastSeen(bob)).toBe(2000)
  expect(statSync(path).mode & 0o777).toBe(0o600)
  // Written atomically: no temporary file is left behind.
  expect(readdirSync(directory)).toEqual(['tui-state.json'])

  reloaded.remove(bob, 3000)
  const removed = TuiState.load(path, self)
  expect(removed.name(bob)).toBeNull()
  expect(removed.lastSeen(bob)).toBeNull()
  expect(removed.isRemoved(bob, 3000)).toBe(true)
  expect(removed.isRemoved(bob, 3001)).toBe(false)
  expect(removed.unreadAfter(bob)).toBe(3000)
})

test('a missing or corrupt file starts empty', () => {
  expect(TuiState.load(join(directory, 'missing.json'), self).names()).toEqual({})
  writeFileSync(path, '{not json')
  const state = TuiState.load(path, self)
  expect(state.names()).toEqual({})
  // And the next change replaces it with a valid file.
  state.setName(bob, 'Bob')
  expect(TuiState.load(path, self).name(bob)).toBe('Bob')
})

test('invalid entries are dropped and the rest kept', () => {
  writeFileSync(path, JSON.stringify({ version: 1, identities: { [self]: { conversations: {
    [bob]: { name: 'Bob', lastSeen: 'yesterday', removedAt: -1 },
    '0xNOT': { name: 'nobody' },
    [generateKeypair().address]: { name: 42 },
  } } } }))
  const state = TuiState.load(path, self)
  expect(state.names()).toEqual({ [bob]: 'Bob' })
  expect(state.lastSeen(bob)).toBeNull()
})

test('each identity keeps its own state in the same file', () => {
  const other = generateKeypair().address
  TuiState.load(path, self).setName(bob, 'Bob')
  TuiState.load(path, other).setName(bob, 'Robert')
  expect(TuiState.load(path, self).name(bob)).toBe('Bob')
  expect(TuiState.load(path, other).name(bob)).toBe('Robert')
  expect(Object.keys(JSON.parse(readFileSync(path, 'utf8')).identities).sort()).toEqual([self, other].sort())
})

test('names are trimmed and capped; an empty name clears it', () => {
  const state = TuiState.memory(self)
  expect(state.setName(bob, 'x'.repeat(NAME_MAX_LENGTH + 10))).toHaveLength(NAME_MAX_LENGTH)
  // Counted in characters, so an emoji is never cut in half.
  expect([...cleanName('🙂'.repeat(NAME_MAX_LENGTH + 1))]).toHaveLength(NAME_MAX_LENGTH)
  expect(state.setName(bob, '   ')).toBe('')
  expect(state.name(bob)).toBeNull()
  expect(state.names()).toEqual({})
})

test('last-seen only moves forward', () => {
  const state = TuiState.memory(self)
  state.markSeen(bob, 5000)
  state.markSeen(bob, 4000)
  expect(state.lastSeen(bob)).toBe(5000)
})

test('a failed save is reported and the state in memory kept', () => {
  writeFileSync(join(directory, 'file'), '')
  const state = TuiState.load(join(directory, 'file', 'tui-state.json'), self)
  const errors: unknown[] = []
  state.onError = error => errors.push(error)
  state.setName(bob, 'Bob')
  expect(errors).toHaveLength(1)
  expect(state.name(bob)).toBe('Bob')
})

test('desktop notifications are on until turned off, per identity', () => {
  const other = generateKeypair().address
  const state = TuiState.load(path, self)
  expect(state.notifications()).toBe(true)
  state.setNotifications(false)
  expect(TuiState.load(path, self).notifications()).toBe(false)
  expect(TuiState.load(path, other).notifications()).toBe(true)
  TuiState.load(path, self).setNotifications(true)
  expect(TuiState.load(path, self).notifications()).toBe(true)
  // On is the default, so it is not written.
  expect(JSON.parse(readFileSync(path, 'utf8')).identities[self]).toEqual({ conversations: {} })
})
