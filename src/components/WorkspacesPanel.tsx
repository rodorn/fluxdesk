'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import { Badge, Button, ErrorText, Field, Input, Select } from '@/components/ui'
import type { McpEntry, RepoEntry, WorkspaceEntry } from '@/lib/store'

const MODES = ['', 'default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions']
const MODELS = ['', 'claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5']

type WorkspaceWithRefs = WorkspaceEntry & {
  primary?: RepoEntry
  extras: RepoEntry[]
  mcp: McpEntry[]
}

export function WorkspacesPanel() {
  const [items, setItems] = useState<WorkspaceWithRefs[]>([])
  const [repos, setRepos] = useState<RepoEntry[]>([])
  const [mcp, setMcp] = useState<McpEntry[]>([])
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const [name, setName] = useState('')
  const [primaryRepoId, setPrimaryRepoId] = useState('')
  const [extraRepoIds, setExtraRepoIds] = useState<string[]>([])
  const [mcpIds, setMcpIds] = useState<string[]>([])
  const [model, setModel] = useState('')
  const [permissionMode, setPermissionMode] = useState('')
  const [allowedTools, setAllowedTools] = useState('')

  const load = useCallback(async () => {
    const [w, r, m] = await Promise.all([
      fetch('/api/workspaces'),
      fetch('/api/repos'),
      fetch('/api/mcp'),
    ])
    const [dw, dr, dm] = await Promise.all([w.json(), r.json(), m.json()])
    if (w.ok) setItems(dw.items)
    if (r.ok) setRepos(dr.items)
    if (m.ok) setMcp(dm.items.filter((x: McpEntry) => x.enabled))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function toggle(list: string[], id: string, set: (v: string[]) => void) {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          primaryRepoId,
          extraRepoIds,
          mcpIds,
          model: model || undefined,
          permissionMode: permissionMode || undefined,
          allowedTools: allowedTools
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setName('')
      setExtraRepoIds([])
      setMcpIds([])
      setAllowedTools('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!confirm('Usunąć tę przestrzeń roboczą?')) return
    await fetch(`/api/workspaces/${id}`, { method: 'DELETE' })
    await load()
  }

  if (repos.length === 0) {
    return (
      <p className="panel px-4 py-8 text-center text-sm muted">
        Najpierw wepnij przynajmniej jedno repozytorium w zakładce „Repozytoria".
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <form onSubmit={create} className="panel space-y-3 px-4 py-4">
        <h2 className="text-sm font-semibold">Nowa przestrzeń robocza</h2>
        <p className="text-xs muted">
          Przestrzeń łączy repozytorium główne (trafia do <span className="mono">cwd</span>),
          dodatkowe repozytoria (<span className="mono">additionalDirectories</span>) i wybrane
          serwery MCP. Sesja uruchomiona z przestrzeni widzi wszystkie te katalogi i narzędzia.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nazwa">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Platforma — API + web"
              required
            />
          </Field>
          <Field label="Repozytorium główne (cwd)">
            <Select
              value={primaryRepoId}
              onChange={(e) => setPrimaryRepoId(e.target.value)}
              required
            >
              <option value="">— wybierz —</option>
              {repos.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Dodatkowe repozytoria">
          <div className="flex flex-wrap gap-2">
            {repos
              .filter((r) => r.id !== primaryRepoId)
              .map((r) => (
                <label
                  key={r.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs"
                  style={{
                    background: extraRepoIds.includes(r.id) ? 'var(--accent-soft)' : 'var(--panel-2)',
                    border: `1px solid ${extraRepoIds.includes(r.id) ? 'var(--accent)' : 'var(--border)'}`,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={extraRepoIds.includes(r.id)}
                    onChange={() => toggle(extraRepoIds, r.id, setExtraRepoIds)}
                  />
                  {r.name}
                </label>
              ))}
            {repos.length < 2 ? <span className="text-xs muted">Wepnij więcej repozytoriów, żeby budować przestrzenie multi-repo.</span> : null}
          </div>
        </Field>

        <Field label="Serwery MCP">
          <div className="flex flex-wrap gap-2">
            {mcp.length === 0 ? (
              <span className="text-xs muted">Brak aktywnych serwerów MCP.</span>
            ) : (
              mcp.map((m) => (
                <label
                  key={m.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs mono"
                  style={{
                    background: mcpIds.includes(m.id) ? 'var(--accent-soft)' : 'var(--panel-2)',
                    border: `1px solid ${mcpIds.includes(m.id) ? 'var(--accent)' : 'var(--border)'}`,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={mcpIds.includes(m.id)}
                    onChange={() => toggle(mcpIds, m.id, setMcpIds)}
                  />
                  {m.name}
                </label>
              ))
            )}
          </div>
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Model">
            <Select value={model} onChange={(e) => setModel(e.target.value)}>
              {MODELS.map((m) => (
                <option key={m} value={m}>
                  {m || 'domyślny'}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tryb uprawnień">
            <Select value={permissionMode} onChange={(e) => setPermissionMode(e.target.value)}>
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {m || 'domyślny'}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Auto-zatwierdzane narzędzia" hint="Po przecinku, np. Read, Grep, mcp__linear">
            <Input
              value={allowedTools}
              onChange={(e) => setAllowedTools(e.target.value)}
              placeholder="Read, Grep"
              className="mono"
            />
          </Field>
        </div>

        <ErrorText>{error}</ErrorText>
        <Button type="submit" variant="primary" disabled={busy || !name.trim() || !primaryRepoId}>
          Utwórz przestrzeń
        </Button>
      </form>

      <div className="grid gap-3 md:grid-cols-2">
        {items.length === 0 ? (
          <p className="panel px-4 py-8 text-center text-sm muted md:col-span-2">
            Brak przestrzeni roboczych.
          </p>
        ) : (
          items.map((w) => (
            <div key={w.id} className="panel space-y-2 px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold">{w.name}</h3>
                <Button variant="danger" onClick={() => remove(w.id)}>
                  Usuń
                </Button>
              </div>

              <div className="space-y-1 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="muted">repo:</span>
                  <Badge tone="accent">{w.primary?.name ?? '— brak —'}</Badge>
                  {w.extras.map((r) => (
                    <Badge key={r.id}>{r.name}</Badge>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="muted">mcp:</span>
                  {w.mcp.length === 0 ? (
                    <span className="muted">—</span>
                  ) : (
                    w.mcp.map((m) => (
                      <Badge key={m.id} tone="ok">
                        {m.name}
                      </Badge>
                    ))
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="muted">ustawienia:</span>
                  <Badge>{w.model ?? 'model domyślny'}</Badge>
                  <Badge>{w.permissionMode ?? 'tryb domyślny'}</Badge>
                  {w.allowedTools.length ? <Badge tone="warn">auto: {w.allowedTools.join(', ')}</Badge> : null}
                </div>
              </div>

              <Link
                href={`/live?workspace=${w.id}`}
                className="inline-block rounded-lg px-3 py-1.5 text-xs font-medium"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                ▶ Uruchom sesję
              </Link>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
