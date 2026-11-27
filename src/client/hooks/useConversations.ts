import type { Address } from '../../shared/address'
import { useState, useEffect, useRef, useCallback } from 'preact/hooks'
import { api, Conversation } from '../lib/api'
import { loadLabels, saveLabels, mergeContacts, loadContacts, markConversationRemoved, isRemoved } from '../lib/contacts'
import { errorMessage } from '../lib/errors'

export type ConversationRefreshResult = 'refreshed' | 'failed' | 'cancelled'

export interface MergedConversation extends Conversation {
  stale?: boolean
}

function withKnownContacts(owner: Address, live: Conversation[]): MergedConversation[] {
  const liveVisible = live.filter(c => !isRemoved(owner, c.address, c.last_message_at))
  const known = mergeContacts(owner, liveVisible)
  const liveAddresses = new Set(liveVisible.map(c => c.address))
  const stale = Object.values(known)
    .filter(c => !liveAddresses.has(c.address))
    .map(c => ({ address: c.address, last_message_at: c.last_message_at, stale: true }))
  return [...liveVisible, ...stale].sort((a, b) => b.last_message_at - a.last_message_at)
}

// The conversations this browser remembers for `owner`, until the server's list arrives.
function cachedConversations(owner: Address): MergedConversation[] {
  return Object.values(loadContacts(owner))
    .map(c => ({ ...c, stale: true }))
    .sort((a, b) => b.last_message_at - a.last_message_at)
}

/** `owner` is the signed-in identity, whose remembered conversations and labels are shown. */
export function useConversations(owner: Address, token: string | null) {
  const [conversations, setConversations] = useState(() => cachedConversations(owner))
  const [error, setError] = useState<string | null>(null)
  const [labels, setLabels] = useState(() => loadLabels(owner))
  const ownerRef = useRef(owner)
  useEffect(() => {
    if (ownerRef.current === owner) return
    ownerRef.current = owner
    setConversations(cachedConversations(owner))
    setLabels(loadLabels(owner))
  }, [owner])
  const debounceRef = useRef<NodeJS.Timeout | null>(null)
  // Refreshes can overlap (token change, SSE, retry click). Only the newest one
  // is allowed to write state, so a slow failure can't clobber a newer success.
  const loadGenRef = useRef(0)
  const tokenRef = useRef(token)
  if (tokenRef.current !== token) {
    tokenRef.current = token
    loadGenRef.current++
  }

  const latestRefresh = useRef<Promise<ConversationRefreshResult> | null>(null)
  const doRefresh = useCallback((): Promise<ConversationRefreshResult> => {
    if (token !== tokenRef.current) return Promise.resolve('cancelled')
    const gen = ++loadGenRef.current
    if (!token) {
      setConversations([])
      setError(null)
      return Promise.resolve('cancelled')
    }
    setError(null)
    // An awaited refresh follows its replacement, so an SSE refresh cannot
    // turn successful recovery into a failure just by finishing first.
    const superseded = (): Promise<ConversationRefreshResult> | ConversationRefreshResult =>
      token === tokenRef.current && latestRefresh.current ? latestRefresh.current : 'cancelled'
    const request = (async (): Promise<ConversationRefreshResult> => {
      try {
        const data = await api.getConversations(token)
        if (gen !== loadGenRef.current) return superseded()
        setConversations(withKnownContacts(owner, data.conversations))
        return 'refreshed'
      } catch (err) {
        if (gen !== loadGenRef.current) return superseded()
        console.error('Failed to load conversations:', err)
        setError(errorMessage(err, 'Failed to load conversations'))
        return 'failed'
      }
    })()
    latestRefresh.current = request
    return request
  }, [owner, token])

  const setLabel = useCallback((address: Address, name: string) => {
    setLabels(prev => {
      const next: Record<Address, string> = { ...prev, [address]: name.trim() }
      if (!name.trim()) delete next[address]
      saveLabels(owner, next)
      return next
    })
  }, [owner])

  // For a partner who is done with that address: off the list, name forgotten.
  // Their next message, if one ever comes, brings the conversation back unnamed.
  const removeConversation = useCallback((address: Address) => {
    markConversationRemoved(owner, address)
    setLabels(prev => {
      const next = { ...prev }
      delete next[address]
      saveLabels(owner, next)
      return next
    })
    setConversations(prev => prev.filter(c => c.address !== address))
  }, [owner])

  // Debounced: SSE can fire a burst of these. A retry click wants `reload`
  // instead, so it isn't deferred behind the 300 ms timer.
  const refresh = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    debounceRef.current = setTimeout(() => {
      doRefresh()
    }, 300)
  }, [doRefresh])

  useEffect(() => {
    doRefresh()
  }, [token, doRefresh])

  useEffect(() => {
    return () => {
      loadGenRef.current++
      latestRefresh.current = null
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [])

  return { conversations, error, refresh, reload: doRefresh, labels, setLabel, removeConversation }
}
