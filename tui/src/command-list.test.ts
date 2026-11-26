import { expect, test } from 'bun:test'
import { COMMANDS, commandHelpLine, completeCommands, completedText } from './command-list'

function words(text: string): string[] {
  return completeCommands(text).map(({ word }) => word)
}

test('a lone / lists every command', () => {
  expect(words('/')).toEqual(COMMANDS.map(command => command.name))
})

test('typing narrows the list, ignoring case, and aliases complete as typed', () => {
  expect(words('/t')).toEqual(['ttl', 'theme'])
  expect(words('/TH')).toEqual(['theme'])
  expect(words('/ex')).toEqual(['exit'])
  expect(words('/addr')).toEqual(['address'])
  expect(words('/zz')).toEqual([])
})

test('an exact name comes first', () => {
  expect(words('/o')).toEqual(['open', 'older'])
  expect(words('/older')).toEqual(['older'])
  expect(words('/n')).toEqual(['new', 'name'])
  expect(words('/name')).toEqual(['name'])
})

test('no list for text, //text, arguments or more than one line', () => {
  expect(words('')).toEqual([])
  expect(words('hello')).toEqual([])
  expect(words('//shrug')).toEqual([])
  expect(words('/ttl 5m')).toEqual([])
  expect(words('/ttl ')).toEqual([])
  expect(words('/t\nmore')).toEqual([])
  expect(words(' /t')).toEqual([])
})

test('completing leaves a space where arguments follow', () => {
  const [ttl] = completeCommands('/tt')
  const [clear] = completeCommands('/cl')
  expect(completedText(ttl!)).toBe('/ttl ')
  expect(completedText(clear!)).toBe('/clear')
})

test('help lines line up and name aliases', () => {
  expect(commandHelpLine(COMMANDS.find(command => command.name === 'clear')!)).toBe(`  ${'/clear'.padEnd(19)}delete all messages for both of you (asks first)`)
  expect(commandHelpLine(COMMANDS.find(command => command.name === 'quit')!)).toContain('quit (also /exit)')
})
