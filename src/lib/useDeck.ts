'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { ExternalSession } from './processes'
import type { TerminalInfo } from './terminals'
import type { TermStatus } from './termstate'
import type { LiveEvent, LiveSessionInfo } from './types'

/** Ile zdarzeń trzymamy w pamięci przeglądarki na sesję. */
const BUFFER = 800

export type DeckApi = {
  sessions: LiveSessionInfo[]
  terminals: TerminalInfo[]
  /** Stan odczytany z ekranu terminala: czeka, pracuje, gotowa. */
  previews: Record<string, TermStatus>
  external: ExternalSession[]
  connected: boolean
  eventsOf: (id: string) => LiveEvent[]
  /** Dociąga historię sesji, która startowała przed otwarciem tej karty. */
  backfill: (id: string) => Promise<void>
  act: (id: string, body: Record<string, unknown>) => Promise<LiveSessionInfo | undefined>
  close: (id: string) => Promise<void>
  closeTerminal: (id: string) => Promise<void>
  killExternal: (pid: number) => Promise<void>
  reload: () => Promise<void>
}

/**
 * Stan pulpitu: jeden strumień SSE na całą kartę, bufory zdarzeń per sesja.
 * Dzięki temu przełączanie między sesjami jest natychmiastowe i nie gubi historii.
 */
export function useDeck(): DeckApi {
  const [sessions, setSessions] = useState<LiveSessionInfo[]>([])
  const [terminals, setTerminals] = useState<TerminalInfo[]>([])
  const [external, setExternal] = useState<ExternalSession[]>([])
  const [previews, setPreviews] = useState<Record<string, TermStatus>>({})
  const [connected, setConnected] = useState(false)
  const [, bump] = useState(0)
  const buffers = useRef(new Map<string, LiveEvent[]>())
  const backfilled = useRef(new Set<string>())

  const appendEvent = useCallback((sessionId: string, event: LiveEvent) => {
    const list = buffers.current.get(sessionId) ?? []
    if (list.some((e) => e.seq === event.seq)) return
    const next = [...list, event].sort((a, b) => a.seq - b.seq)
    buffers.current.set(sessionId, next.length > BUFFER ? next.slice(-BUFFER) : next)
    bump((n) => n + 1)
  }, [])

  useEffect(() => {
    const es = new EventSource('/api/live/stream')

    es.addEventListener('sessions', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { items: LiveSessionInfo[] }
      setSessions(data.items)
      setConnected(true)
    })

    es.addEventListener('event', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        sessionId: string
        event: LiveEvent
      }
      appendEvent(data.sessionId, data.event)
    })

    es.onerror = () => setConnected(false)
    es.onopen = () => setConnected(true)

    return () => es.close()
  }, [appendEvent])

  const eventsOf = useCallback((id: string) => buffers.current.get(id) ?? [], [])

  const backfill = useCallback(async (id: string) => {
    if (backfilled.current.has(id)) return
    backfilled.current.add(id)
    try {
      const res = await fetch(`/api/live/${id}?cursor=-1`)
      if (!res.ok) return
      const data = (await res.json()) as { events: LiveEvent[] }
      const existing = buffers.current.get(id) ?? []
      const merged = [...data.events, ...existing]
      const seen = new Set<number>()
      const unique = merged
        .filter((e) => (seen.has(e.seq) ? false : (seen.add(e.seq), true)))
        .sort((a, b) => a.seq - b.seq)
      buffers.current.set(id, unique.slice(-BUFFER))
      bump((n) => n + 1)
    } catch {
      backfilled.current.delete(id)
    }
  }, [])

  const reload = useCallback(async () => {
    // Panel bywa restartowany w trakcie pracy; zerwane zapytanie nie może
    // wywracać interfejsu, bo za chwilę i tak spróbujemy ponownie.
    const [live, term] = await Promise.all([
      fetch('/api/live')
        .then((r) => (r.ok ? r.json() : undefined))
        .catch(() => undefined),
      fetch('/api/term')
        .then((r) => (r.ok ? r.json() : undefined))
        .catch(() => undefined),
    ])
    if (live) setSessions(live.items as LiveSessionInfo[])
    if (term) {
      const items = term.items as TerminalInfo[]
      setTerminals(items)
      // Stanu nie da się odczytać inaczej niż z ekranu, więc dopytujemy o niego
      // osobno dla każdego żywego terminala.
      for (const t of items) {
        if (!t.alive) continue
        fetch(`/api/term/${t.id}/preview`)
          .then((r) => (r.ok ? r.json() : undefined))
          .then((d) => {
            if (d) setPreviews((prev) => ({ ...prev, [t.id]: d as TermStatus }))
          })
          .catch(() => undefined)
      }
    }
  }, [])

  const reloadExternal = useCallback(async () => {
    const proc = await fetch('/api/processes')
      .then((r) => (r.ok ? r.json() : undefined))
      .catch(() => undefined)
    if (proc) setExternal((proc.items as ExternalSession[]).filter((p) => !p.ownedByPanel))
  }, [])

  // Terminale nie mają własnego strumienia, więc odpytujemy je co kilka sekund.
  useEffect(() => {
    reload()
    const t = setInterval(reload, 4000)
    return () => clearInterval(t)
  }, [reload])

  // Procesy spoza panelu zmieniają się rzadko, a ich skan jest droższy.
  useEffect(() => {
    reloadExternal()
    const t = setInterval(reloadExternal, 60_000)
    return () => clearInterval(t)
  }, [reloadExternal])

  const act = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      const res = await fetch(`/api/live/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => {
        throw new Error('Panel chwilowo nie odpowiada')
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Akcja nie powiodła się')
      setSessions((prev) => prev.map((s) => (s.id === id ? (data as LiveSessionInfo) : s)))
      return data as LiveSessionInfo
    },
    []
  )

  const close = useCallback(
    async (id: string) => {
      await fetch(`/api/live/${id}`, { method: 'DELETE' }).catch(() => undefined)
      buffers.current.delete(id)
      backfilled.current.delete(id)
      await reload()
    },
    [reload]
  )

  const closeTerminal = useCallback(
    async (id: string) => {
      await fetch(`/api/term/${id}`, { method: 'DELETE' }).catch(() => undefined)
      await reload()
    },
    [reload]
  )

  const killExternal = useCallback(
    async (pid: number) => {
      await fetch(`/api/processes?pid=${pid}`, { method: 'DELETE' }).catch(() => undefined)
      await reloadExternal()
    },
    [reloadExternal]
  )

  return {
    sessions,
    terminals,
    previews,
    external,
    connected,
    eventsOf,
    backfill,
    act,
    close,
    closeTerminal,
    killExternal,
    reload,
  }
}
