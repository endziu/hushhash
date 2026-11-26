import { parseAddress, type Address } from '../../src/shared/address'
import { parseLiveEvent, type LiveEvent } from '../../src/shared/live-events'
import { sealMessage, unsealMessage, type DecryptedMessage } from '../../src/shared/protocol-client'
import type { ConversationProtocol, SessionOptions } from '../../src/client/lib/conversation-session'
import { ChatClient } from '../../src/cli/client'
import { setTimeout as delay } from 'node:timers/promises'
import type { MessageStamp } from './unread'

const MAX_BACKOFF_MS = 30_000

/** One open live stream; only equality has meaning. */
export type ConnectionEpoch = NonNullable<SessionOptions['connection']>

/** Where the live event stream is. */
export type LiveStatus =
  | { state: 'connecting' }
  | { state: 'connected' }
  /**
   * The last attempt failed for `reason`; the next starts at `retryAt`
   * (Date.now() time) and stays in this state until it opens or fails.
   * `failures` counts the attempts that failed in a row.
   */
  | { state: 'retrying', reason: string, retryAt: number, failures: number }

export interface LiveHandlers {
  event(event: LiveEvent): void
  /** A stream opened (a new epoch) or was lost (null). */
  connection(epoch: ConnectionEpoch | null): void
  status(status: LiveStatus): void
}

/**
 * The CLI's ChatClient shaped for the TUI: one identity signed in to one
 * server, serving each conversation as a ConversationSession expects and
 * keeping one live event stream open for all of them.
 */
export class IdentitySession extends ChatClient {
  get address(): Address {
    return this.identity.address
  }

  /** The server as one conversation sees it, for a ConversationSession. */
  protocol(partner: Address, refreshConversations: () => Promise<boolean>): ConversationProtocol {
    return {
      partnerPubkey: () => this.api.pubkey(partner),
      history: (limit, before) => this.authenticated(token => this.api.history(partner, token, { limit, before })),
      recover: cursor => this.authenticated(token => this.api.recover(partner, token, cursor)),
      states: ids => this.authenticated(token => this.api.states(partner, ids, token)),
      open: ids => this.authenticated(token => this.api.open(partner, ids, token)),
      clear: () => this.authenticated(token => this.api.clear(partner, token)),
      refreshConversations,
      send: async (plaintext, ttl, partnerPubkey) => {
        const envelope = await sealMessage(this.identity, partner, partnerPubkey, plaintext, ttl)
        return this.authenticated(token => this.api.send(this.identity, envelope, token))
      },
    }
  }

  /**
   * Who sent the newest `limit` messages with `partner`, and when, without
   * decrypting them; `full` when there may be older ones.
   */
  async recentStamps(partner: Address, limit: number): Promise<{ messages: MessageStamp[]; full: boolean }> {
    const page = await this.authenticated(token => this.api.history(partner, token, { limit }))
    const messages: MessageStamp[] = []
    for (const raw of page.messages as { id?: unknown; sender?: unknown; created_at?: unknown }[]) {
      const sender = parseAddress(raw?.sender)
      if (typeof raw?.id === 'string' && sender && typeof raw.created_at === 'number') messages.push({ id: raw.id, sender, created_at: raw.created_at })
    }
    return { messages, full: page.messages.length >= limit }
  }

  /** Verifies and decrypts a delivered message of the conversation with `partner`; null for anything else. */
  decryptor(partner: Address): (input: unknown) => Promise<DecryptedMessage | null> {
    return async input => {
      if (typeof input !== 'object' || input === null) return null
      const raw = input as { sender?: unknown; recipient?: unknown }
      if (raw.sender !== partner && raw.recipient !== partner) return null
      return unsealMessage(this.identity, input, partner).catch(() => null)
    }
  }

  /** Keeps a live event stream open, reconnecting with backoff, until abort(). */
  async live(handlers: LiveHandlers): Promise<void> {
    let backoff = 1000
    let failures = 0
    while (!this.signal.aborted) {
      let opened = false
      // A retry stays `retrying`, so offline and its reason stay on screen.
      if (failures === 0) handlers.status({ state: 'connecting' })
      try {
        for await (const frame of this.events(this.signal, () => {
          opened = true
          backoff = 1000
          failures = 0
          handlers.connection(Symbol('live stream'))
          handlers.status({ state: 'connected' })
        })) {
          const event = parseLiveEvent(frame.event, frame.data)
          if (event) handlers.event(event)
        }
        if (!this.signal.aborted) throw new Error('Live connection closed')
      } catch (error) {
        if (this.signal.aborted) return
        if (opened) handlers.connection(null)
        failures++
        const reason = error instanceof Error ? error.message : 'Connection failed'
        handlers.status({ state: 'retrying', reason, retryAt: Date.now() + backoff, failures })
        await delay(backoff, undefined, { signal: this.signal }).catch(() => {})
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
      }
    }
  }

  /** Stops everything and revokes the session. */
  override async close(): Promise<void> {
    this.abort()
    await super.close()
  }
}
