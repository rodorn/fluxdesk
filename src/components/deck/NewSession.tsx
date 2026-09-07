'use client'

import { useEffect, useRef, useState } from 'react'

import { Overlay } from '@/components/deck/Overlay'
import { Button, ErrorText, Field, Input, Select } from '@/components/ui'
import type { LiveSessionInfo } from '@/lib/types'

/** Katalog domyślny — najczęściej startujesz z katalogu domowego. */
/** Katalog domyślny; panel podpowiada katalog domowy użytkownika. */
const DEFAULT_CWD = ''

const MODELS = [
  { value: '', label: 'domyślny' },
  { value: 'opus', label: 'opus' },
  { value: 'sonnet', label: 'sonnet' },
  { value: 'haiku', label: 'haiku' },
]

const MODES = [
  { value: 'bypassPermissions', label: 'bypass — nie pytaj o nic' },
  { value: 'default', label: 'pytaj o każde narzędzie' },
  { value: 'acceptEdits', label: 'edycje bez pytania' },
  { value: 'plan', label: 'tryb planowania' },
]

/**
 * Szybkie uruchomienie sesji — odpowiednik wpisania `claude` w katalogu projektu.
 * Enter w dowolnym polu startuje, więc da się to zrobić bez ruszania myszy.
 */
export function NewSession({
  defaults,
  onClose,
  onStarted,
}: {
  defaults?: {
    cwd?: string
    title?: string
    resume?: string
    workspaceId?: string
    terminal?: boolean
  }
  onClose: () => void
  onStarted: (info: LiveSessionInfo) => void
}) {
  const [title, setTitle] = useState(defaults?.title ?? '')
  const [cwd, setCwd] = useState(defaults?.cwd ?? DEFAULT_CWD)
  const [model, setModel] = useState('')
  const [mode, setMode] = useState('bypassPermissions')
  const [prompt, setPrompt] = useState('')
  const [terminal, setTerminal] = useState(defaults?.terminal ?? false)
  const [dirs, setDirs] = useState<string[]>([])
  const [repos, setRepos] = useState<{ id: string; name: string; path: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const first = useRef<HTMLInputElement>(null)

  useEffect(() => {
    first.current?.focus()
  }, [])

  // Wpięte repozytoria — jeden klik zamiast wpisywania ścieżki.
  useEffect(() => {
    fetch('/api/repos')
      .then((r) => (r.ok ? r.json() : undefined))
      .then((d) => d && setRepos(d.items))
      .catch(() => undefined)
  }, [])

  // Podpowiedzi katalogów dla aktualnie wpisywanej ścieżki.
  useEffect(() => {
    const parent = cwd.endsWith('/') ? cwd : cwd.slice(0, cwd.lastIndexOf('/') + 1)
    if (!parent.startsWith('/')) return
    let cancelled = false
    fetch(`/api/fs?path=${encodeURIComponent(parent)}`)
      .then((r) => (r.ok ? r.json() : undefined))
      .then((d) => {
        if (!cancelled && d?.dirs) setDirs((d.dirs as { path: string }[]).map((x) => x.path))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [cwd])

  async function start() {
    if (busy) return
    if (!terminal && !prompt.trim()) {
      setError('Podaj pierwszy prompt — sesja startuje od niego')
      return
    }
    if (!cwd.trim() && !defaults?.workspaceId) {
      setError('Podaj katalog roboczy')
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      if (terminal) {
        const res = await fetch('/api/term', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cwd: cwd.trim(),
            title: title.trim() || undefined,
            model: model || undefined,
            permissionMode: mode,
            resume: defaults?.resume,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Nie udało się wystartować')
        onStarted(data as LiveSessionInfo)
        return
      }
      const res = await fetch('/api/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cwd: cwd.trim() || undefined,
          workspaceId: defaults?.workspaceId,
          prompt: prompt.trim(),
          title: title.trim() || undefined,
          model: model || undefined,
          permissionMode: mode,
          resume: defaults?.resume,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Nie udało się wystartować')
      onStarted(data as LiveSessionInfo)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      start()
    }
  }

  return (
    <Overlay
      title={defaults?.resume ? 'Wznów sesję' : 'Nowa sesja'}
      hint="Enter uruchamia · Esc zamyka"
      onClose={onClose}
    >
      <div className="space-y-3" onKeyDown={onKey}>
        <Field label="Nazwa" hint="Pusta = pierwsze słowa promptu">
          <Input
            ref={first}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="np. refaktor importera"
          />
        </Field>

        <Field label="Katalog" hint="Ścieżka bezwzględna; podpowiedzi z dysku">
          <Input
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="/ścieżka/do/projektu"
            list="csm-dirs"
            spellCheck={false}
          />
        </Field>
        {repos.length ? (
          <div className="flex flex-wrap gap-1">
            {repos.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setCwd(r.path)}
                className="rounded px-1.5 py-0.5 text-[10px]"
                style={{
                  background: cwd === r.path ? 'var(--accent)' : 'var(--panel-2)',
                  color: cwd === r.path ? '#fff' : 'var(--muted)',
                }}
                title={r.path}
              >
                {r.name}
              </button>
            ))}
          </div>
        ) : null}

        <datalist id="csm-dirs">
          {dirs.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Model">
            <Select value={model} onChange={(e) => setModel(e.target.value)}>
              {MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Uprawnienia">
            <Select value={mode} onChange={(e) => setMode(e.target.value)}>
              {MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={terminal}
            onChange={(e) => setTerminal(e.target.checked)}
          />
          <span>
            Prawdziwy terminal — pełny <span className="mono">claude</span> ze wszystkimi komendami
            (bez kolejki i widgetów panelu)
          </span>
        </label>

        {terminal ? null : (
        <Field label="Pierwszy prompt">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            className="w-full resize-y rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: 'var(--panel)', border: '1px solid var(--border)' }}
            placeholder="Co ma zrobić?"
          />
        </Field>
        )}

        <ErrorText>{error}</ErrorText>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Anuluj</Button>
          <Button variant="primary" onClick={start} disabled={busy}>
            {busy ? 'Uruchamiam…' : 'Uruchom'}
          </Button>
        </div>
      </div>
    </Overlay>
  )
}
