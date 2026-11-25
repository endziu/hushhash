import { expect, test } from 'bun:test'
import { LINE_BREAK as B, PasteFilter } from './paste'

const START = '\x1b[200~'
const END = '\x1b[201~'

test('a bracketed paste becomes one edit with line breaks marked', () => {
  const filter = new PasteFilter()
  expect(filter.write(`hi ${START}line0\nline1\r\nline2\rline3${END}!\r`)).toBe(`hi line0${B}line1${B}line2${B}line3!\r`)
})

test('typed Enter still sends, Alt+Enter adds a line break, and other keys pass through', () => {
  const filter = new PasteFilter()
  expect(filter.write('a\x1b\rb\x1b[D\x1b[I\x03\r')).toBe(`a${B}b\x1b[D\x1b[I\x03\r`)
})

test('pasted control characters cannot press keys', () => {
  const filter = new PasteFilter()
  expect(filter.write(`${START}a\x03\x1b[Ab\tc\x7f\x9b${END}`)).toBe('a[Ab\tc')
})

test('markers and line breaks split across reads are reassembled', () => {
  const filter = new PasteFilter()
  const chunks = ['x\x1b', '[20', '0~one\r', '\ntwo\x1b[2', '01', '~\r']
  expect(chunks.map(chunk => filter.write(chunk)).join('')).toBe(`xone${B}two\r`)
  expect(filter.pending).toBe(false)
})

test('held input that is not a marker is released by flush', () => {
  const filter = new PasteFilter()
  expect(filter.write('a\x1b')).toBe('a')
  expect(filter.pending).toBe(true)
  expect(filter.flush()).toBe('\x1b')
  expect(filter.write('\x1b[2')).toBe('')
  expect(filter.write('x')).toBe('\x1b[2x')
})
