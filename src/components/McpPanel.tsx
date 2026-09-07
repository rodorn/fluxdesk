'use client'

import { useCallback, useEffect, useState } from 'react'

import { Badge, Button, ErrorText, Field, Input, Select } from '@/components/ui'
import type { McpProbeResult } from '@/lib/mcp-probe'
import type { McpEntry, McpTransport } from '@/lib/store'

type Discovered = {
  source: string
  name: string
  transport: McpTransport
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  alreadyAdded: boolean
}

function parseKeyValues(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return out
}

export function McpPanel({ onChanged }: { onChanged?: () => void }) {
  const [items, setItems] = useState<McpEntry[]>([])
  const [discovered, setDiscovered] = useState<Discovered[]>([])
  const [probes, setProbes] = useState<Record<string, McpProbeResult | 'pending'>>({})
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const [name, setName] = useState('')
  const [transport, setTransport] = useState<McpTransport>('stdio')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [url, setUrl] = useState('')
  const [envText, setEnvText] = useState('')

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([fetch('/api/mcp'), fetch('/api/mcp/import')])
    const da = await a.json()
    const db = await b.json()
    if (a.ok) setItems(da.items)
    if (b.ok) setDiscovered(db.items.filter((d: Discovered) => !d.alreadyAdded))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const res = await fetch('/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          transport,
          command: transport === 'stdio' ? command : undefined,
          args: transport === 'stdio' ? args.split(' ').filter(Boolean) : undefined,
          env: transport === 'stdio' ? parseKeyValues(envText) : undefined,
          url: transport !== 'stdio' ? url : undefined,
          headers: transport !== 'stdio' ? parseKeyValues(envText) : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setName('')
      setCommand('')
      setArgs('')
      setUrl('')
      setEnvText('')
      await load()
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function test(id: string) {
    setProbes((p) => ({ ...p, [id]: 'pending' }))
    const res = await fetch(`/api/mcp/${id}/test`, { method: 'POST' })
    const data = await res.json()
    setProbes((p) => ({
      ...p,
      [id]: res.ok
        ? data
        : { name: '', status: 'failed', error: data.error, tools: [], durationMs: 0 },
    }))
  }

  async function toggle(entry: McpEntry) {
    await fetch(`/api/mcp/${entry.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !entry.enabled }),
    })
    await load()
    onChanged?.()
  }

  async function remove(id: string) {
    if (!confirm('Usunąć ten serwer MCP z panelu?')) return
    await fetch(`/api/mcp/${id}`, { method: 'DELETE' })
    await load()
    onChanged?.()
  }

  async function importAll() {
    const res = await fetch('/api/mcp/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ servers: discovered }),
    })
    const data = await res.json()
    if (!res.ok) setError(data.error)
    await load()
    onChanged?.()
  }

  return (
    <div className="space-y-4">
      {discovered.length ? (
        <div className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="text-sm">
            Znaleziono {discovered.length} serwer(ów) w plikach konfiguracyjnych:{' '}
            <span className="mono muted">{[...new Set(discovered.map((d) => d.source))].join(', ')}</span>
          </div>
          <Button variant="primary" onClick={importAll}>
            Importuj wszystkie
          </Button>
        </div>
      ) : null}

      <form onSubmit={add} className="panel space-y-3 px-4 py-4">
        <h2 className="text-sm font-semibold">Dodaj serwer MCP</h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <Field label="Nazwa" hint="Narzędzia trafią do Claude jako mcp__nazwa__*">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="linear"
              required
              className="mono"
            />
          </Field>
          <Field label="Transport">
            <Select value={transport} onChange={(e) => setTransport(e.target.value as McpTransport)}>
              <option value="stdio">stdio</option>
              <option value="http">http</option>
              <option value="sse">sse</option>
            </Select>
          </Field>
        </div>

        {transport === 'stdio' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Polecenie">
              <Input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="npx"
                required
                className="mono"
              />
            </Field>
            <Field label="Argumenty (rozdzielone spacją)">
              <Input
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder="-y @modelcontextprotocol/server-filesystem /dane"
                className="mono"
              />
            </Field>
          </div>
        ) : (
          <Field label="Adres URL">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://przyklad.com/mcp"
              required
              className="mono"
            />
          </Field>
        )}

        <Field
          label={transport === 'stdio' ? 'Zmienne środowiskowe' : 'Nagłówki'}
          hint="Po jednym na linię, w formacie KLUCZ=wartość"
        >
          <textarea
            value={envText}
            onChange={(e) => setEnvText(e.target.value)}
            rows={2}
            className="w-full resize-y rounded-lg px-3 py-2 text-sm mono outline-none"
            style={{ background: 'var(--panel)', border: '1px solid var(--border)' }}
            placeholder={transport === 'stdio' ? 'API_KEY=xxx' : 'Authorization=Bearer xxx'}
          />
        </Field>

        <ErrorText>{error}</ErrorText>
        <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
          Dodaj serwer
        </Button>
      </form>

      <div className="panel overflow-hidden">
        {items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm muted">Brak wpiętych serwerów MCP.</p>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {items.map((m) => {
              const probe = probes[m.id]
              return (
                <li key={m.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium mono">{m.name}</span>
                      <Badge>{m.transport}</Badge>
                      {m.enabled ? <Badge tone="ok">aktywny</Badge> : <Badge>wyłączony</Badge>}
                      {probe === 'pending' ? (
                        <Badge tone="warn">testuję…</Badge>
                      ) : probe ? (
                        <>
                          <Badge tone={probe.status === 'connected' ? 'ok' : 'err'}>
                            {probe.status === 'connected' ? 'połączono' : 'błąd'}
                            {probe.tools.length ? ` · ${probe.tools.length} narzędzi` : ''}
                            {` · ${probe.durationMs} ms`}
                          </Badge>
                          {probe.serverInfo?.name ? (
                            <Badge>
                              {probe.serverInfo.name}
                              {probe.serverInfo.version ? ` ${probe.serverInfo.version}` : ''}
                            </Badge>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] mono muted wrap-anywhere">
                      {m.transport === 'stdio'
                        ? [m.command, ...(m.args ?? [])].join(' ')
                        : m.url}
                    </div>
                    {probe && probe !== 'pending' && probe.error ? (
                      <div className="mt-1 text-[11px]" style={{ color: 'var(--err)' }}>
                        {probe.error}
                      </div>
                    ) : null}
                    {probe && probe !== 'pending' && probe.tools.length ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {probe.tools.slice(0, 12).map((t) => (
                          <Badge key={t}>{t}</Badge>
                        ))}
                        {probe.tools.length > 12 ? (
                          <Badge>+{probe.tools.length - 12}</Badge>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button onClick={() => test(m.id)} disabled={probe === 'pending'}>
                      Testuj
                    </Button>
                    <Button onClick={() => toggle(m)}>{m.enabled ? 'Wyłącz' : 'Włącz'}</Button>
                    <Button variant="danger" onClick={() => remove(m.id)}>
                      Usuń
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
