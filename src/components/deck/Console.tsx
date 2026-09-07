'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { EventView, StatusDot } from '@/components/deck/EventView'
import { Composer } from '@/components/deck/Composer'
import { ToolPreview } from '@/components/deck/ToolPreview'
import { Button } from '@/components/ui'
import { fmtUsd, shortenPath } from '@/lib/format'
import type { LiveEvent, LiveSessionInfo, TodoItem } from '@/lib/types'

export const PERMISSION_MODES = [
  { value: 'default', label: 'pytaj' },
  { value: 'acceptEdits', label: 'edycje bez pytania' },
  { value: 'plan', label: 'plan' },
  { value: 'bypassPermissions', label: 'bypass' },
]

/** Ile kontekstu zajęła ostatnia tura. Limit okna to 200 tys. tokenów. */
function ContextMeter({ tokens, limit = 200_000 }: { tokens: number; limit?: number }) {
  const share = Math.min(1, tokens / limit)
  const tone = share > 0.85 ? 'var(--err)' : share > 0.6 ? 'var(--warn)' : 'var(--ok)'
  // Powyżej progu warto zdążyć ze streszczeniem, zanim rozmowa utnie się sama.
  const advice = share > 0.85 ? ' — czas na /compact' : ''
  return (
    <span
      className="inline-flex items-center gap-1"
      title={`Kontekst ostatniej tury: ${tokens.toLocaleString('pl-PL')} z ${limit.toLocaleString('pl-PL')} tokenów`}
    >
      <span
        className="inline-block h-1.5 w-10 overflow-hidden rounded-full"
        style={{ background: 'var(--panel-2)' }}
      >
        <span
          className="block h-full rounded-full"
          style={{ width: `${Math.max(3, share * 100)}%`, background: tone }}
        />
      </span>
      {Math.round(share * 100)}%
      {advice ? <span style={{ color: tone }}>{advice}</span> : null}
    </span>
  )
}

function TodoBar({ todos }: { todos: TodoItem[] }) {
  if (!todos.length) return null
  const done = todos.filter((t) => t.status === 'completed').length
  const current = todos.find((t) => t.status === 'in_progress')
  return (
    <details className="rounded-lg px-3 py-2" style={{ background: 'var(--panel-2)' }}>
      <summary className="cursor-pointer text-[11px] muted">
        Zadania {done}/{todos.length}
        {current ? ` · teraz: ${current.activeForm ?? current.content}` : ''}
      </summary>
      <ul className="mt-2 space-y-1 text-xs">
        {todos.map((t, i) => (
          <li key={i} className="flex gap-2">
            <span
              style={{
                color:
                  t.status === 'completed'
                    ? 'var(--ok)'
                    : t.status === 'in_progress'
                      ? 'var(--accent)'
                      : 'var(--muted)',
              }}
            >
              {t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▸' : '·'}
            </span>
            <span style={{ opacity: t.status === 'completed' ? 0.55 : 1 }}>{t.content}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}

/** Zwinięty ciąg narzędzi: jedna linia z nazwami, rozwijana do pełnych wpisów. */
function ToolGroup({ events }: { events: LiveEvent[] }) {
  const [open, setOpen] = useState(false)
  const names = events
    .filter((e) => e.kind === 'tool-use')
    .map((e) => String((e.data as Record<string, unknown>).name))
  const failed = events.some((e) => (e.data as Record<string, unknown>).isError === true)

  if (open) {
    return (
      <div className="space-y-2">
        <button onClick={() => setOpen(false)} className="text-[10px] underline muted">
          zwiń {names.length} operacji
        </button>
        {events.map((e) => (
          <EventView key={e.seq} event={e} />
        ))}
      </div>
    )
  }

  return (
    <button
      onClick={() => setOpen(true)}
      className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[11px]"
      style={{
        background: 'var(--panel)',
        border: `1px solid ${failed ? 'var(--err)' : 'var(--border)'}`,
      }}
    >
      <span className="muted">{names.length || events.length} operacji</span>
      <span className="min-w-0 flex-1 truncate mono muted">
        {[...new Set(names)].slice(0, 6).join(' · ')}
      </span>
      {failed ? <span style={{ color: 'var(--err)' }}>błąd</span> : null}
      <span className="muted">▸</span>
    </button>
  )
}

export function Console({
  info,
  events,
  inputRef,
  onAct,
  onClose,
  onError,
}: {
  info: LiveSessionInfo
  events: LiveEvent[]
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  onAct: (body: Record<string, unknown>) => Promise<unknown>
  onClose: () => void
  onError: (msg: string) => void
}) {
  const [find, setFind] = useState('')
  const [findOpen, setFindOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  // Autoprzewijanie tylko wtedy, gdy czytasz koniec — inaczej czytanie historii by uciekało.
  useEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [events.length, info.pending.length])

  async function run(body: Record<string, unknown>) {
    try {
      await onAct(body)
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    }
  }

  const finished = info.status === 'stopped' || info.status === 'error'
  const needle = find.trim().toLowerCase()
  const matches = (e: LiveEvent) =>
    !needle || JSON.stringify(e.data).toLowerCase().includes(needle)
  const visible = events.filter(matches).filter(
    (e) =>
      e.kind !== 'status' &&
      e.kind !== 'permission-request' &&
      e.kind !== 'queued' &&
      e.kind !== 'todos'
  )

  // Ciąg wywołań narzędzi zbijamy w jeden blok — inaczej rozmowa tonie w kartach.
  const groups: { key: string; tools: typeof visible; event?: (typeof visible)[number] }[] = []
  for (const e of visible) {
    const isTool = e.kind === 'tool-use' || e.kind === 'tool-result'
    const last = groups.at(-1)
    if (isTool && last && last.tools.length && !last.event) {
      last.tools.push(e)
    } else if (isTool) {
      groups.push({ key: `t${e.seq}`, tools: [e] })
    } else {
      groups.push({ key: `e${e.seq}`, tools: [], event: e })
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="panel flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{info.title}</div>
          <div className="flex flex-wrap items-center gap-x-2 text-[11px] muted">
            <StatusDot status={info.status} />
            {info.workspaceName ? <span>⊞ {info.workspaceName}</span> : null}
            <span className="mono">{shortenPath(info.cwd, 3)}</span>
            {info.model ? <span>{info.model.replace(/^claude-/, '')}</span> : null}
            {info.totalCostUsd ? <span>{fmtUsd(info.totalCostUsd)}</span> : null}
            {info.contextTokens ? <ContextMeter tokens={info.contextTokens} /> : null}
            {info.mcpServers.map((m) => (
              <span
                key={m.name}
                className="mono"
                style={{ color: m.status === 'connected' ? 'var(--ok)' : 'var(--err)' }}
                title={`MCP ${m.name}: ${m.status}`}
              >
                mcp:{m.name}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <select
            value={info.permissionMode}
            onChange={(e) => run({ action: 'permissionMode', mode: e.target.value })}
            className="rounded-lg px-2 py-1 text-[11px]"
            style={{ background: 'var(--panel-2)', border: '1px solid var(--border)' }}
            title="Tryb uprawnień (Alt+U)"
          >
            {PERMISSION_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          {info.sessionId ? (
            <Link
              href={`/sessions/${info.sessionId}`}
              className="rounded-lg px-2.5 py-1.5 text-xs"
              style={{ background: 'var(--panel-2)' }}
            >
              Transkrypt
            </Link>
          ) : null}
          <Button onClick={() => setFindOpen((v) => !v)} title="Szukaj w rozmowie">
            Szukaj
          </Button>
          <Button onClick={() => run({ action: 'interrupt' })} title="Przerwij (Esc)">
            Przerwij
          </Button>
          <Button variant="danger" onClick={onClose} title="Zamknij sesję (Alt+W)">
            Zamknij
          </Button>
        </div>
      </div>

      {info.autoAllow.length ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] muted">
          <span>zawsze zezwalasz:</span>
          {info.autoAllow.map((rule) => (
            <button
              key={rule}
              onClick={() => run({ action: 'revokeAutoAllow', ruleKey: rule })}
              className="rounded px-1.5 py-0.5 mono"
              style={{ background: 'var(--panel-2)' }}
              title="Kliknij, aby cofnąć regułę"
            >
              {rule} ✕
            </button>
          ))}
        </div>
      ) : null}

      <TodoBar todos={info.todos} />

      {info.pending.map((p, idx) => (
        <div
          key={p.id}
          className="rounded-xl px-3 py-2.5"
          style={{ background: 'var(--panel)', border: '1px solid var(--warn)' }}
        >
          <div className="text-sm font-medium">
            Zgoda na <span className="mono">{p.ruleKey}</span>
            {idx === 0 ? <span className="ml-2 text-[10px] muted">Y zezwól · A zawsze · N odrzuć</span> : null}
          </div>
          <div className="mt-1.5">
            <ToolPreview toolName={p.toolName} input={p.input} />
          </div>
          <div className="mt-2 flex gap-2">
            <Button
              variant="primary"
              onClick={() => run({ action: 'permission', permissionId: p.id, decision: 'allow' })}
            >
              Zezwól
            </Button>
            <Button
              onClick={() =>
                run({ action: 'permission', permissionId: p.id, decision: 'allow-always' })
              }
            >
              Zawsze dla {p.ruleKey}
            </Button>
            <Button
              variant="danger"
              onClick={() => run({ action: 'permission', permissionId: p.id, decision: 'deny' })}
            >
              Odrzuć
            </Button>
          </div>
        </div>
      ))}

      {findOpen ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={find}
            onChange={(e) => setFind(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setFind('')
                setFindOpen(false)
              }
            }}
            placeholder="Szukaj w rozmowie…"
            className="min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-xs outline-none"
            style={{ background: 'var(--panel-2)', border: '1px solid var(--border)' }}
          />
          <span className="text-[10px] muted">{groups.length} pasujących</span>
          <button
            onClick={() => {
              setFind('')
              setFindOpen(false)
            }}
            className="text-[10px] underline muted"
          >
            zamknij
          </button>
        </div>
      ) : null}

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1"
      >
        {groups.length === 0 ? (
          <p className="py-8 text-center text-sm muted">Czekam na pierwsze zdarzenia…</p>
        ) : (
          groups.map((g) =>
            g.event ? (
              <EventView key={g.key} event={g.event} />
            ) : (
              <ToolGroup key={g.key} events={g.tools} />
            )
          )
        )}
      </div>

      {info.queued.length ? (
        <div className="space-y-1">
          {info.queued.map((q, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs"
              style={{ background: 'var(--panel-2)', border: '1px dashed var(--border)' }}
            >
              <span className="muted shrink-0">w kolejce {i + 1}</span>
              <span className="min-w-0 flex-1 truncate">{q}</span>
              <button
                onClick={() => run({ action: 'unqueue', index: i })}
                className="shrink-0 muted"
                title="Usuń z kolejki"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {finished ? (
        <Composer
          cwd={info.cwd}
          slashCommands={info.slashCommands}
          placeholder="Sesja zakończona. Napisz, aby wznowić ją pod tym samym ID…"
          accent="var(--warn)"
          inputRef={inputRef}
          onSend={(t) => run({ action: 'restart', text: t })}
        />
      ) : (
        <Composer
          cwd={info.cwd}
          slashCommands={info.slashCommands}
          placeholder={
            info.status === 'idle'
              ? 'Napisz do Claude…'
              : 'Pisz dalej, prompt wejdzie do kolejki'
          }
          inputRef={inputRef}
          onSend={(t, images) => {
            stickToBottom.current = true
            run({ action: 'send', text: t, images })
          }}
        />
      )}
    </div>
  )
}
