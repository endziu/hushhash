import { expect, test } from 'bun:test'
import { generateKeypair } from '../../src/shared/keypair'
import type { DeliveredMessage } from '../../src/shared/message-envelope'
import type { DecryptedMessage } from '../../src/shared/protocol-client'
import { Outbox } from './outbox'

const self = generateKeypair().address
const partner = generateKeypair().address

function delivered(id: string, created_at: number): DeliveredMessage {
  return {
    version: 2, id, sender: self, recipient: partner, ttl: 300, delivery_policy: 'recipient-opening' as never,
    created_at, opened_at: null, expires_at: created_at + 86_400_000,
    ct_recipient: '', ephemeral_pub_recipient: '', iv_recipient: '', ct_sender: '', ephemeral_pub_sender: '', iv_sender: '', signature: '',
  }
}

test('a message shows as sending, then as accepted under its id until the conversation has it', () => {
  const outbox = new Outbox(self)
  const key = outbox.add('hello', 1000)
  expect(outbox.merge([], 1000)).toMatchObject([{ key, sender: self, plaintext: 'hello', outgoing: 'sending' }])

  outbox.delivered(key, delivered('0xabc', 1001))
  expect(outbox.merge([], 1002)).toMatchObject([{ key: '0xabc', plaintext: 'hello', outgoing: null, opened_at: null }])

  // The conversation's own copy replaces it.
  const copy: DecryptedMessage = { ...delivered('0xabc', 1001), plaintext: 'hello' }
  expect(outbox.merge([copy], 1003)).toHaveLength(1)
  expect(outbox.merge([], 1004)).toHaveLength(0)
})

test('a failed message stays until the next send or a clear', () => {
  const outbox = new Outbox(self)
  outbox.failed(outbox.add('lost', 1000))
  expect(outbox.merge([], 1000)).toMatchObject([{ outgoing: 'failed', plaintext: 'lost' }])
  outbox.clearFailed()
  expect(outbox.merge([], 1000)).toHaveLength(0)

  outbox.add('pending', 1000)
  outbox.clear()
  expect(outbox.merge([], 1000)).toHaveLength(0)
})

test('an accepted message that expires before its copy arrives is forgotten', () => {
  const outbox = new Outbox(self)
  const key = outbox.add('brief', 1000)
  outbox.delivered(key, delivered('0xdef', 1000))
  expect(outbox.merge([], 1000 + 86_400_000)).toHaveLength(0)
})
