import type { Address } from '../../src/shared/address'
import type { Keypair } from '../../src/shared/keypair'
import { CLIENT_UPDATE_REQUIRED_CODE } from '../../src/shared/api-error'
import { parseLiveEvent, type LiveEvent } from '../../src/shared/live-events'
import { ApiError, ProtocolClient, readApiError, sealMessage, unsealMessage, type Conversation, type DecryptedMessage } from '../../src/shared/protocol-client'
import type { ConversationProtocol, SessionOptions } from '../../src/client/lib/conversation-session'
import { setTimeout as delay } from 'node:timers/promises'

// Push suppression lapses 45 s after the last report of an attentive stream.
const ATTENTION_HEARTBEAT_MS = 20_000
// Focus flips quickly when switching windows; report it once settled.
const ATTENTION_SETTLE_MS = 300
// The server pings every 30 s; a silent stream is dead.
const READ_TIMEOUT_MS = 65_000
const MAX_BACKOFF_MS = 30_000
const MAX_FRAME_BYTES = 4_100_000

/** One open live stream; only equality has meaning. */
export type ConnectionEpoch = NonNullable<SessionOptions['connection']>

export class ClientUpdateRequiredError extends Error {
  constructor() {
    super('This hushhash TUI is out of date for this server. Run git pull, then bun install in the repository and in tui/.')
  }
}

export interface LiveHandlers {
  event(event: LiveEvent): void
  /** A stream opened (a new epoch) or was lost (null). */
  connection(epoch: ConnectionEpoch | null): void
  status(text: string): void
}

/**
 * One identity signed in to one server: its session token, its live event
 * stream and the attention it reports for that stream. Attention decides
 * whether this terminal suppresses push notifications, as a browser window's
 * focus does.
 */
export class Account {
  readonly api: ProtocolClient
  private token: string | null = null
  private loginPending: Promise<void> | null = null
  private readonly controller = new AbortController()
  /** Aborted by stop(), or with a ClientUpdateRequiredError once the server refuses this client. */
  readonly signal = this.controller.signal
  private requestSignal: AbortSignal | undefined = this.signal

  private attentive = true
  private stream: string | null = null
  private attentionSequence = 0
  private reported: boolean | null = null
  private settle: ReturnType<typeof setTimeout> | undefined

  constructor(readonly origin: string, readonly identity: Keypair) {
    this.api = new ProtocolClient(origin, (path, init) => {
      const headers = new Headers(init.headers)
      headers.set('Origin', origin)
      return fetch(origin + path, {
        ...init,
        headers,
        redirect: 'error',
        signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(this.requestSignal ? [this.requestSignal] : [])]),
      })
    }, error => this.stopIfOutdated(error))
  }

  get address(): Address {
    return this.identity.address
  }

  stop(reason?: unknown): void {
    this.controller.abort(reason)
  }

  private stopIfOutdated(error: ApiError): Error | void {
    if (error.code !== CLIENT_UPDATE_REQUIRED_CODE) return
    const stopped = new ClientUpdateRequiredError()
    this.stop(stopped)
    return stopped
  }

  async login(): Promise<void> {
    if (this.loginPending) return this.loginPending
    this.loginPending = (async () => {
      if (await this.api.pubkey(this.address) === null) await this.api.register(this.identity)
      this.token = await this.api.login(this.identity)
    })()
    try { await this.loginPending } finally { this.loginPending = null }
  }

  /** Runs a request with the session token, signing in first and once more if the session expired. */
  async authenticated<T>(request: (token: string) => Promise<T>): Promise<T> {
    if (!this.token) await this.login()
    try {
      return await request(this.token!)
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error
      this.token = null
      await this.login()
      return request(this.token!)
    }
  }

  conversations(): Promise<Conversation[]> {
    return this.authenticated(token => this.api.conversations(token))
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

  /** Verifies and decrypts a delivered message of the conversation with `partner`; null for anything else. */
  decryptor(partner: Address): (input: unknown) => Promise<DecryptedMessage | null> {
    return async input => {
      if (typeof input !== 'object' || input === null) return null
      const raw = input as { sender?: unknown; recipient?: unknown }
      if (raw.sender !== partner && raw.recipient !== partner) return null
      return unsealMessage(this.identity, input, partner).catch(() => null)
    }
  }

  /** The terminal gained or lost focus. */
  setAttention(attentive: boolean): void {
    this.attentive = attentive
    clearTimeout(this.settle)
    this.settle = setTimeout(() => {
      if (this.attentive !== this.reported) this.sendAttention(this.attentive)
    }, ATTENTION_SETTLE_MS)
  }

  private sendAttention(attentive: boolean): void {
    const stream = this.stream
    if (!stream || this.signal.aborted) return
    this.reported = attentive
    const sequence = ++this.attentionSequence
    void this.authenticated(token => this.api.request('/api/events/attention', {
      method: 'POST', body: { stream, attentive, sequence }, token,
    })).catch(() => {
      // Unknown to the server now; the next change or heartbeat resends.
      if (this.stream === stream && this.reported === attentive) this.reported = null
    })
  }

  /** Keeps a live event stream open, reconnecting with backoff, until stop(). */
  async live(handlers: LiveHandlers): Promise<void> {
    const heartbeat = setInterval(() => {
      if (this.attentive || this.attentive !== this.reported) this.sendAttention(this.attentive)
    }, ATTENTION_HEARTBEAT_MS)
    let backoff = 1000
    try {
      while (!this.signal.aborted) {
        let opened = false
        try {
          for await (const event of this.events(() => {
            opened = true
            backoff = 1000
            handlers.connection(Symbol('live stream'))
            handlers.status('Connected')
          })) handlers.event(event)
          if (!this.signal.aborted) throw new Error('Live connection closed')
        } catch (error) {
          if (this.signal.aborted) return
          this.stream = null
          this.reported = null
          if (opened) handlers.connection(null)
          handlers.status(`${error instanceof Error ? error.message : 'Connection failed'}; reconnecting in ${backoff / 1000}s`)
          await delay(backoff, undefined, { signal: this.signal }).catch(() => {})
          backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
        }
      }
    } finally {
      clearInterval(heartbeat)
      clearTimeout(this.settle)
      this.stream = null
    }
  }

  private async *events(onOpen: () => void): AsyncGenerator<LiveEvent> {
    const sseToken = await this.authenticated(token => this.api.sseToken(token))
    const controller = new AbortController()
    const dialed = this.attentive
    const connectTimer = setTimeout(() => controller.abort(), 15_000)
    let response: Response
    try {
      response = await fetch(`${this.origin}/api/events?token=${encodeURIComponent(sseToken)}&attentive=${dialed}`, {
        headers: { Origin: this.origin },
        redirect: 'error',
        signal: AbortSignal.any([this.signal, controller.signal]),
      })
    } finally { clearTimeout(connectTimer) }
    if (!response.ok || !response.body) {
      if (!response.ok) this.stopIfOutdated(await readApiError(response))
      controller.abort()
      throw new Error(`Live connection failed: HTTP ${response.status}`)
    }
    this.stream = sseToken
    this.attentionSequence = 0
    // The URL told the server; report only a change since dialing.
    this.reported = dialed
    if (this.attentive !== dialed) this.sendAttention(this.attentive)
    onOpen()
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS)
        let result: Awaited<ReturnType<typeof reader.read>>
        try { result = await reader.read() } finally { clearTimeout(timer) }
        if (result.done) return
        buffer += decoder.decode(result.value, { stream: true })
        let end: number
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const lines = buffer.slice(0, end).split('\n')
          buffer = buffer.slice(end + 2)
          // An unnamed frame is a 'message', as in the browser's EventSource.
          const name = lines.find(line => line.startsWith('event:'))?.slice(6).trim() ?? 'message'
          const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
          const event = parseLiveEvent(name, data)
          if (event) yield event
        }
        if (buffer.length > MAX_FRAME_BYTES) throw new Error('Live event exceeds message size limit')
      }
    } finally {
      controller.abort()
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  }

  /** Stops everything and revokes the session. */
  async close(): Promise<void> {
    this.stop()
    if (!this.token) return
    // Logout must work after the requests above were cancelled.
    this.requestSignal = undefined
    try { await this.api.deleteSession(this.token) } finally { this.token = null }
  }
}
