'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import { fmtBytes, fmtRelative, fmtTokens, fmtUsd, shortenPath } from '@/lib/format'
import type { SessionListItem } from '@/lib/sessions'

const SORTS = [
  { key: 'recent', label: 'Ostatnie' },
  { key: 'oldest', label: 'Najstarsze' },
  { key: 'cost', label: 'Koszt' },
  { key: 'tokens', label: 'Tokeny' },
  { key: 'messages', label: 'Wiadomości' },
] as const

export function SessionList() {
  const params = useSearchParams()
  const cwd = params.get('cwd') || ''

  const [q, setQ] = useState('')
  const [sort, setSort] = useState<string>('recent')
  const [items, setItems] = useState<SessionListItem[]>([])
  const [total, setTotal] = useState(0)
  const [limit, setLimit] = useState(50)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  const load = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      const url = new URL('/api/sessions', window.location.origin)
      if (cwd) url.searchParams.set('cwd', cwd)
      if (q) url.searchParams.set('q', q)
      url.searchParams.set('sort', sort)
      url.searchParams.set('limit', String(limit))
      const res = await fetch(url)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Błąd wczytywania')
      setItems(data.items)
      setTotal(data.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [cwd, q, sort, limit])

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0)
    return () => clearTimeout(t)
  }, [load, q])

  async function remove(id: string) {
    if (!confirm('Usunąć transkrypt tej sesji? Operacji nie da się cofnąć.')) return
    const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' })
    if (res.ok) setItems((prev) => prev.filter((i) => i.sessionId !== id))
    else alert('Nie udało się usunąć sesji')
  }

  async function rename(id: string, current: string) {
    const title = prompt('Nowy tytuł sesji:', current)
    if (title == null) return
    const res = await fetch(`/api/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    if (res.ok) load()
    else alert('Nie udało się zmienić tytułu')
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 2xl:max-w-[100rem]">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Sesje</h1>
          <p className="mt-1 text-sm muted">
            {cwd ? (
              <>
                Projekt <span className="mono">{shortenPath(cwd, 4)}</span> ·{' '}
                <Link href="/sessions" className="accent underline">
                  pokaż wszystkie
                </Link>
              </>
            ) : (
              `${total} sesji łącznie`
            )}
          </p>
        </div>
        <Link
          href="/live"
          className="rounded-lg px-3 py-2 text-sm font-medium"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          + Nowa sesja
        </Link>
      </header>

      <div className="flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Szukaj po tytule, ścieżce, gałęzi, ID…"
          className="min-w-0 flex-1 rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: 'var(--panel)', border: '1px solid var(--border)' }}
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="rounded-lg px-3 py-2 text-sm"
          style={{ background: 'var(--panel)', border: '1px solid var(--border)' }}
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <div className="panel px-4 py-3 text-sm" style={{ color: 'var(--err)' }}>
          {error}
        </div>
      ) : null}

      <div className="panel overflow-hidden">
        {loading && items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm muted">Wczytywanie…</p>
        ) : items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm muted">Brak sesji spełniających kryteria.</p>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {items.map((s) => (
              <li key={s.sessionId} className="group flex items-start gap-3 px-4 py-3">
                <Link href={`/sessions/${s.sessionId}`} className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {s.customTitle || s.summary}
                    {s.tag ? (
                      <span
                        className="ml-2 rounded px-1.5 py-0.5 text-[10px]"
                        style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                      >
                        {s.tag}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] muted">
                    <span className="mono">{shortenPath(s.cwd, 3)}</span>
                    {s.gitBranch ? <span>⑂ {s.gitBranch}</span> : null}
                    <span>{fmtRelative(s.lastModified)}</span>
                    <span>{s.messageCount} wiad.</span>
                    <span>{fmtTokens(s.totalTokens)} tok.</span>
                    <span>{fmtUsd(s.costUsd)}</span>
                    <span>{fmtBytes(s.fileSize)}</span>
                  </div>
                </Link>
                <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <button
                    onClick={() => rename(s.sessionId, s.customTitle || s.summary)}
                    className="rounded px-2 py-1 text-xs"
                    style={{ background: 'var(--panel-2)' }}
                    title="Zmień tytuł"
                  >
                    ✎
                  </button>
                  <Link
                    href={`/live?resume=${s.sessionId}&cwd=${encodeURIComponent(s.cwd || '')}`}
                    className="rounded px-2 py-1 text-xs"
                    style={{ background: 'var(--panel-2)' }}
                    title="Wznów sesję"
                  >
                    ▶
                  </Link>
                  <button
                    onClick={() => remove(s.sessionId)}
                    className="rounded px-2 py-1 text-xs"
                    style={{ background: 'var(--panel-2)', color: 'var(--err)' }}
                    title="Usuń"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {items.length < total ? (
        <button
          onClick={() => setLimit((l) => l + 50)}
          className="w-full rounded-lg py-2 text-sm"
          style={{ background: 'var(--panel)', border: '1px solid var(--border)' }}
        >
          Wczytaj więcej ({items.length} z {total})
        </button>
      ) : null}
    </div>
  )
}
