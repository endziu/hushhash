import { expect, test } from 'bun:test'
import { t } from '@opentui/core'
import { PRIORITY, fitBar } from './bar'

const plain = (text: { chunks: { text: string }[] }) => text.chunks.map(chunk => chunk.text).join('')

test('a bar drops the least important items first and keeps the order', () => {
  const items = [
    { text: t`aaaa`, priority: PRIORITY.essential },
    { text: t`bbbb`, priority: PRIORITY.normal },
    { text: t`cccc`, priority: PRIORITY.high },
    { text: t`dddd`, priority: PRIORITY.normal },
  ]
  const fit = (width: number) => plain(fitBar(items, width, t`${' '}`))
  expect(fit(19)).toBe('aaaa bbbb cccc dddd')
  expect(fit(18)).toBe('aaaa bbbb cccc')
  expect(fit(13)).toBe('aaaa cccc')
  expect(fit(8)).toBe('aaaa')
  expect(fit(3)).toBe('')
})
