'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function SessionActions({
  sessionId,
  cwd,
  title,
}: {
  sessionId: string
  cwd?: string
  title: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const btn = {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
  } as const

  async function rename() {
    const next = prompt('Nowy tytuł sesji:', title)
    if (next == null) return
    setBusy(true)
    await fetch(`/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: next }),
    })
    setBusy(false)
    router.refresh()
  }

  async function tag() {
    const next = prompt('Etykieta sesji (pusta = usuń):', '')
    if (next == null) return
    setBusy(true)
    await fetch(`/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag: next.trim() || null }),
    })
    setBusy(false)
    router.refresh()
  }

  async function fork() {
    setBusy(true)
    const res = await fetch(`/api/sessions/${sessionId}/fork`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const data = await res.json()
    setBusy(false)
    if (res.ok && data.sessionId) router.push(`/sessions/${data.sessionId}`)
    else alert(data.error || 'Nie udało się rozgałęzić sesji')
  }

  async function remove() {
    if (!confirm('Usunąć transkrypt tej sesji?')) return
    setBusy(true)
    const res = await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' })
    setBusy(false)
    if (res.ok) router.push('/sessions')
    else alert('Nie udało się usunąć sesji')
  }

  return (
    <div className="flex flex-wrap gap-2 text-xs" aria-busy={busy}>
      <a
        href={`/live?resume=${sessionId}&cwd=${encodeURIComponent(cwd || '')}`}
        className="rounded-lg px-3 py-1.5 font-medium"
        style={{ background: 'var(--accent)', color: '#fff' }}
      >
        ▶ Wznów w przeglądarce
      </a>
      <button onClick={rename} disabled={busy} className="rounded-lg px-3 py-1.5" style={btn}>
        Zmień tytuł
      </button>
      <button onClick={tag} disabled={busy} className="rounded-lg px-3 py-1.5" style={btn}>
        Etykieta
      </button>
      <button onClick={fork} disabled={busy} className="rounded-lg px-3 py-1.5" style={btn}>
        Rozgałęź
      </button>
      <button
        onClick={remove}
        disabled={busy}
        className="rounded-lg px-3 py-1.5"
        style={{ ...btn, color: 'var(--err)' }}
      >
        Usuń
      </button>
    </div>
  )
}
