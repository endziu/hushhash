import { expect, test } from 'bun:test'
import { TextAttributes } from '@opentui/core'
import { messageText } from './links'

test('links carry their URL where the terminal supports hyperlinks, other text does not', () => {
  const { chunks } = messageText('see https://example.com/a?b=1, and ftp://x.org or mailto:a@b.c', true)
  expect(chunks.map(chunk => chunk.text)).toEqual(['see ', 'https://example.com/a?b=1', ', and ftp://x.org or mailto:a@b.c'])
  expect(chunks.map(chunk => chunk.link?.url)).toEqual([undefined, 'https://example.com/a?b=1', undefined])
  expect(chunks[1]!.attributes! & TextAttributes.UNDERLINE).toBeTruthy()
  expect(chunks[0]!.attributes ?? 0).toBe(0)
})

test('without hyperlink support, links are underlined but carry no URL', () => {
  const { chunks } = messageText('http://example.com', false)
  expect(chunks).toHaveLength(1)
  expect(chunks[0]!.link).toBeUndefined()
  expect(chunks[0]!.attributes! & TextAttributes.UNDERLINE).toBeTruthy()
})

test('control characters in a link cannot reach the terminal, in its text or its URL', () => {
  const { chunks } = messageText('go https://evil.example/\x1b]8;;https://other\x07x\x9c now\nok', true)
  const link = chunks.find(chunk => chunk.link)!
  // eslint-disable-next-line no-control-regex -- the point of the test
  const control = /[\u0000-\u001f\u007f-\u009f]/
  expect(link.link!.url).not.toMatch(control)
  expect(link.text).not.toMatch(control)
  expect(link.link!.url).toStartWith('https://evil.example/\\u001b]8;;https://other\\u0007x\\u009c')
  // Message newlines stay, for the transcript to lay out.
  expect(chunks.at(-1)!.text).toBe(' now\nok')
})
