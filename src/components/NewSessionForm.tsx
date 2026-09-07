'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { Badge, Button, ErrorText, Field, Input, Select, fieldStyle } from '@/components/ui'
import type { McpEntry, RepoEntry } from '@/lib/store'
import type { LiveSessionInfo } from '@/lib/types'

const MODES = [
  { value: '', label: 'z przestrzeni / domyślny' },
  { value: 'default', label: 'default — pytaj o ryzykowne operacje' },
  { value: 'acceptEdits', label: 'acceptEdits — auto-akceptuj edycje plików' },
  { value: 'plan', label: 'plan — tylko planowanie, bez wykonywania' },
  { value: 'dontAsk', label: 'dontAsk — nie pytaj, odrzucaj niezatwierdzone' },
  { value: 'bypassPermissions', label: 'bypassPermissions — bez pytań (ostrożnie!)' },
]

const MODELS = ['', 'claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5']

type WorkspaceWithRefs = {
  id: string
  name: string
  primary?: RepoEntry
  extras: RepoEntry[]
  mcp: McpEntry[]
  model?: string
  permissionMode?: string
  allowedTools: string[]
}

type BrowseData = {
  path: string
  parent: string | null
  dirs: { name: string; path: string }[]
}

export function NewSessionForm({
  initialCwd,
  initialWorkspaceId,
  resume,
  onStarted,
}: {
  initialCwd?: string
  initialWorkspaceId?: string
  resume?: string
  onStarted: (info: LiveSessionInfo) => void
}) {
  const [workspaces, setWorkspaces] = useState<WorkspaceWithRefs[]>([])
  const [source, setSource] = useState<'workspace' | 'adhoc'>(
    initialWorkspaceId ? 'workspace' : initialCwd ? 'adhoc' : 'workspace'
  )
  const [workspaceId, setWorkspaceId] = useState(initialWorkspaceId ?? '')
  const [cwd, setCwd] = useState(initialCwd || '')
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('')
  const [mode, setMode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [browsing, setBrowsing] = useState(false)
  const [browse, setBrowse] = useState<BrowseData>()

  useEffect(() => {
    fetch('/api/workspaces')
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.items)) {
          setWorkspaces(d.items)
          if (!initialWorkspaceId && d.items.length === 0 && !initialCwd) setSource('adhoc')
        }
      })
      .catch(() => setSource('adhoc'))
  }, [initialWorkspaceId, initialCwd])

  useEffect(() => {
    if (!browsing) return
    const url = new URL('/api/fs', window.location.origin)
    if (cwd) url.searchParams.set('path', cwd)
    fetch(url)
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setBrowse(d)))
      .catch((e) => setError(String(e)))
  }, [browsing, cwd])

  const selected = workspaces.find((w) => w.id === workspaceId)

  async function start(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const res = await fetch('/api/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(source === 'workspace' ? { workspaceId } : { cwd }),
          prompt,
          model: model || undefined,
          permissionMode: mode || undefined,
          resume: resume || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Nie udało się uruchomić sesji')
      setPrompt('')
      onStarted(data as LiveSessionInfo)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const ready = prompt.trim() && (source === 'workspace' ? workspaceId : cwd)

  return (
    <form onSubmit={start} className="panel space-y-3 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {resume ? 'Wznów sesję' : 'Nowa sesja'}
          {resume ? (
            <span className="ml-2 text-[11px] mono muted">{resume.slice(0, 8)}…</span>
          ) : null}
        </h2>
        <div className="flex gap-1">
          {(['workspace', 'adhoc'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSource(s)}
              className="rounded-lg px-2.5 py-1 text-xs"
              style={{
                background: source === s ? 'var(--accent-soft)' : 'var(--panel-2)',
                color: source === s ? 'var(--accent)' : 'var(--text)',
                border: `1px solid ${source === s ? 'var(--accent)' : 'var(--border)'}`,
              }}
            >
              {s === 'workspace' ? 'Przestrzeń robocza' : 'Pojedynczy katalog'}
            </button>
          ))}
        </div>
      </div>

      {source === 'workspace' ? (
        workspaces.length === 0 ? (
          <p className="text-xs muted">
            Nie masz jeszcze przestrzeni roboczych.{' '}
            <Link href="/workspaces" className="accent underline">
              Utwórz pierwszą
            </Link>{' '}
            albo przełącz się na pojedynczy katalog.
          </p>
        ) : (
          <>
            <Field label="Przestrzeń">
              <Select
                value={workspaceId}
                onChange={(e) => setWorkspaceId(e.target.value)}
                required
              >
                <option value="">— wybierz —</option>
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </Field>
            {selected ? (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="muted">wepnie:</span>
                <Badge tone="accent">{selected.primary?.name ?? '?'}</Badge>
                {selected.extras.map((r) => (
                  <Badge key={r.id}>{r.name}</Badge>
                ))}
                {selected.mcp.map((m) => (
                  <Badge key={m.id} tone="ok">
                    mcp: {m.name}
                  </Badge>
                ))}
              </div>
            ) : null}
          </>
        )
      ) : (
        <div>
          <Field label="Katalog roboczy">
            <div className="flex gap-2">
              <Input
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="/home/uzytkownik/projekt"
                required
                className="mono"
              />
              <Button type="button" onClick={() => setBrowsing((b) => !b)}>
                📁
              </Button>
            </div>
          </Field>
          {browsing && browse ? (
            <div className="mt-2 max-h-52 overflow-auto rounded-lg p-2 text-xs" style={fieldStyle}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="truncate mono muted">{browse.path}</span>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => {
                    setCwd(browse.path)
                    setBrowsing(false)
                  }}
                >
                  Wybierz
                </Button>
              </div>
              {browse.parent ? (
                <button
                  type="button"
                  onClick={() => setCwd(browse.parent!)}
                  className="block w-full truncate rounded px-2 py-1 text-left hover:opacity-70"
                >
                  ../
                </button>
              ) : null}
              {browse.dirs.map((d) => (
                <button
                  key={d.path}
                  type="button"
                  onClick={() => setCwd(d.path)}
                  className="block w-full truncate rounded px-2 py-1 text-left mono hover:opacity-70"
                >
                  {d.name}/
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}

      <Field label="Polecenie">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          required
          placeholder="Np. Przejrzyj testy i napraw błędy w module auth."
          className="w-full resize-y rounded-lg px-3 py-2 text-sm outline-none"
          style={fieldStyle}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Model"
          hint={selected?.model ? `przestrzeń ustawia: ${selected.model}` : undefined}
        >
          <Select value={model} onChange={(e) => setModel(e.target.value)}>
            {MODELS.map((m) => (
              <option key={m} value={m}>
                {m || 'z przestrzeni / domyślny'}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Tryb uprawnień"
          hint={selected?.permissionMode ? `przestrzeń ustawia: ${selected.permissionMode}` : undefined}
        >
          <Select value={mode} onChange={(e) => setMode(e.target.value)}>
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <ErrorText>{error}</ErrorText>

      <Button type="submit" variant="primary" disabled={busy || !ready} className="w-full py-2 text-sm">
        {busy ? 'Uruchamianie…' : resume ? 'Wznów sesję' : 'Uruchom sesję'}
      </Button>
    </form>
  )
}
