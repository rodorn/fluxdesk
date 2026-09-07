'use client'

import { useCallback, useEffect, useState } from 'react'

import { Badge, Button, ErrorText, Field, Input } from '@/components/ui'
import { fmtRelative } from '@/lib/format'
import type { RepoInfo } from '@/lib/git'
import type { RepoEntry } from '@/lib/store'

export type RepoWithInfo = RepoEntry & { info: RepoInfo }

export function ReposPanel({ onChanged }: { onChanged?: () => void }) {
  const [items, setItems] = useState<RepoWithInfo[]>([])
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [tags, setTags] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/repos')
      const data = await res.json()
      if (res.ok) setItems(data.items)
      else setError(data.error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const res = await fetch('/api/repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path,
          name: name || undefined,
          tags: tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setPath('')
      setName('')
      setTags('')
      await load()
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!confirm('Odpiąć to repozytorium od panelu? Pliki na dysku zostają nietknięte.')) return
    const res = await fetch(`/api/repos/${id}`, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) setError(data.error)
    else {
      await load()
      onChanged?.()
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="panel space-y-3 px-4 py-4">
        <h2 className="text-sm font-semibold">Wepnij repozytorium</h2>
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
          <Field label="Ścieżka na dysku">
            <Input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/home/uzytkownik/projekty/api"
              required
              className="mono"
            />
          </Field>
          <Field label="Nazwa (opcjonalnie)">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="nazwa katalogu"
            />
          </Field>
          <Field label="Etykiety (po przecinku)">
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="backend, klient-x" />
          </Field>
        </div>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" variant="primary" disabled={busy || !path.trim()}>
          {busy ? 'Sprawdzam…' : 'Dodaj repozytorium'}
        </Button>
      </form>

      <div className="panel overflow-hidden">
        {loading && items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm muted">Wczytywanie…</p>
        ) : items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm muted">
            Nie wpięto jeszcze żadnego repozytorium.
          </p>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {items.map((r) => (
              <li key={r.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{r.name}</span>
                    {!r.info.exists ? (
                      <Badge tone="err">brak katalogu</Badge>
                    ) : r.info.isGit ? (
                      <Badge tone="accent">⑂ {r.info.branch ?? '?'}</Badge>
                    ) : (
                      <Badge>nie-git</Badge>
                    )}
                    {r.info.dirtyFiles ? (
                      <Badge tone="warn">{r.info.dirtyFiles} zmian</Badge>
                    ) : r.info.isGit ? (
                      <Badge tone="ok">czysto</Badge>
                    ) : null}
                    {r.info.hasClaudeMd ? <Badge>CLAUDE.md</Badge> : null}
                    {r.info.hasMcpConfig ? <Badge>.mcp.json</Badge> : null}
                    {r.tags.map((t) => (
                      <Badge key={t} tone="accent">
                        {t}
                      </Badge>
                    ))}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] mono muted wrap-anywhere">{r.path}</div>
                  {r.info.lastCommit ? (
                    <div className="mt-0.5 text-[11px] muted">
                      {r.info.lastCommit.hash} · {r.info.lastCommit.subject.slice(0, 70)} ·{' '}
                      {fmtRelative(Date.parse(r.info.lastCommit.date))}
                    </div>
                  ) : null}
                </div>
                <Button variant="danger" onClick={() => remove(r.id)}>
                  Odepnij
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
