import { expect, test } from 'bun:test'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defaultIdentityPath } from './identity'

test('the default identity follows HUSHHASH_IDENTITY, then XDG_CONFIG_HOME, then ~/.config', () => {
  expect(defaultIdentityPath({ HUSHHASH_IDENTITY: '/keys/me.json', XDG_CONFIG_HOME: '/xdg' })).toBe('/keys/me.json')
  expect(defaultIdentityPath({ XDG_CONFIG_HOME: '/xdg' })).toBe('/xdg/hushhash/identity.json')
  expect(defaultIdentityPath({})).toBe(join(homedir(), '.config', 'hushhash', 'identity.json'))
})
