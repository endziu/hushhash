import { expect, test } from 'bun:test'
import { AttentionReporter } from './attention-reporter'

function track() {
  const sent: [string, boolean, number][] = []
  const window = { attentive: true }
  const reporter = new AttentionReporter(async (stream, attentive, sequence) => { sent.push([stream, attentive, sequence]) }, () => window.attentive)
  const set = (attentive: boolean) => { window.attentive = attentive; reporter.changed() }
  return { reporter, sent, set }
}

test('reports a change since dialling at once, and later changes once settled', async () => {
  const { reporter, sent, set } = track()
  reporter.opened('s1', false)
  expect(sent).toEqual([['s1', true, 1]])
  set(false)
  set(true)
  set(false)
  expect(sent).toHaveLength(1)
  await Bun.sleep(350)
  expect(sent).toEqual([['s1', true, 1], ['s1', false, 2]])
  reporter.dispose()
})

test('reports nothing between streams and numbers each stream from one', async () => {
  const { reporter, sent, set } = track()
  reporter.opened('s1', true)
  expect(sent).toEqual([])
  reporter.closed()
  set(false)
  await Bun.sleep(350)
  expect(sent).toEqual([])
  reporter.opened('s2', true)
  expect(sent).toEqual([['s2', false, 1]])
  reporter.dispose()
  reporter.opened('s3', true)
  expect(sent).toHaveLength(1)
})

test('resends a change the server never received', async () => {
  let fail = true
  let attentive = true
  const sent: boolean[] = []
  const reporter = new AttentionReporter(async (_stream, value) => {
    sent.push(value)
    if (fail) throw new Error('offline')
  }, () => attentive)
  reporter.opened('s1', true)
  attentive = false
  reporter.changed()
  await Bun.sleep(350)
  fail = false
  // Unchanged, but unconfirmed, so it is sent once more.
  reporter.changed()
  await Bun.sleep(350)
  expect(sent).toEqual([false, false])
  reporter.dispose()
})

test('reports what attention is once settled, not what an event said', async () => {
  const sent: boolean[] = []
  let attentive = true
  const reporter = new AttentionReporter(async (_stream, value) => { sent.push(value) }, () => attentive)
  reporter.opened('s1', true)
  reporter.changed()
  // Focus moved again without an event of its own.
  attentive = false
  await Bun.sleep(350)
  expect(sent).toEqual([false])
  reporter.dispose()
})
