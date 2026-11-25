import { expect, test } from 'bun:test'
import { terminalText } from './terminal-text'

test('neutralizes terminal escapes, line injection and bidi controls', () => {
  expect(terminalText('\x1b]52;c;secret\x07\npeer:\u202etest')).toBe('\\u001b]52;c;secret\\u0007 ↵ peer:\\u202etest')
  expect(terminalText('hello 😛')).toBe('hello 😛')
})

test('escapes every direction mark and isolate, not only overrides', () => {
  expect(terminalText('a\u061cb\u200ec\u200fd\u202ae\u2066f\u2069g')).toBe('a\\u061cb\\u200ec\\u200fd\\u202ae\\u2066f\\u2069g')
})

test('keeps newlines when asked, still escaping other controls', () => {
  expect(terminalText('a\x1b[31mb\u009bc\rd\u202ee\u2066f\ng\th', { newlines: true }))
    .toBe('a\\u001b[31mb\\u009bc\\u000dd\\u202ee\\u2066f\ng  h')
})
