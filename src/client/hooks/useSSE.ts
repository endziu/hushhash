import { useEffect, useState, useRef } from 'preact/hooks'
import { isWindowAttentive } from '../lib/window-attention'
import { api } from '../lib/api'
import { AttentionReporter } from '../lib/attention-reporter'
import { SseConnection, type ConnectionEpoch } from '../lib/sse-connection'
import type { LiveEvent } from '../../shared/live-events'

export interface LiveConnection { current: ConnectionEpoch | null }

/** `onConnectionChange` hears each change of `connection.current` as it happens, before Preact renders. */
export function useSSE(token: string | null, onEvent: (event: LiveEvent) => void, onConnectionChange: (connection: ConnectionEpoch | null) => void) {
  const [connected, setConnected] = useState<ConnectionEpoch | null>(null)
  // Updated synchronously at the transport boundary, before Preact renders.
  const connection = useRef<ConnectionEpoch | null>(null)

  useEffect(() => {
    if (!token) {
      setConnected(null)
      return
    }
    const activeToken: string = token

    // The server only needs attention changes, plus a heartbeat while
    // attentive to outlive its TTL; the reporter settles focus flips first.
    const attention = new AttentionReporter(
      (stream, attentive, sequence) => api.setSseAttention(activeToken, stream, attentive, sequence),
      isWindowAttentive,
    )
    let dialedAttention = false
    // EventSource alone cannot recover: a non-2xx response (cap 429, stale
    // token 401) ends it permanently, and its automatic retry of a dropped
    // stream re-dials a single-use token that now 401s. SseConnection drives
    // recovery with a fresh token and backoff on every failure.
    const conn = new SseConnection({
      getSseToken: () => api.getSseToken(activeToken),
      buildUrl: (sseToken) => {
        dialedAttention = isWindowAttentive()
        return `/api/events?token=${sseToken}&attentive=${dialedAttention}`
      },
      onOpen: (sseToken) => {
        attention.opened(sseToken, dialedAttention)
        connection.current = Symbol('SSE connection')
        onConnectionChange(connection.current)
        setConnected(connection.current)
      },
      onDisconnect: () => {
        attention.closed()
        connection.current = null
        onConnectionChange(null)
        setConnected(null)
      },
      onEvent,
    })
    const update = () => {
      conn.setActive(document.visibilityState === 'visible')
      attention.changed()
    }
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
    update()
    if (document.visibilityState === 'visible') conn.connect()

    return () => {
      document.removeEventListener('visibilitychange', update)
      window.removeEventListener('focus', update)
      window.removeEventListener('blur', update)
      attention.dispose()
      connection.current = null
      conn.close()
      onConnectionChange(null)
      setConnected(null)
    }
  }, [token, onEvent, onConnectionChange])

  return { connected: connected !== null, connection }
}
