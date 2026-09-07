'use client'

import { StatusDot, toolSummary } from '@/components/deck/EventView'
import { Button } from '@/components/ui'
import { fmtRelative, shortenPath } from '@/lib/format'
import type { LiveEvent, LiveSessionInfo } from '@/lib/types'

/** Jedna linijka podglądu — co sesja właśnie zrobiła. */
function line(e: LiveEvent): string {
  const d = e.data as Record<string, unknown>
  switch (e.kind) {
    case 'user-text':
      return `› ${String(d.text)}`
    case 'assistant-text':
      return String(d.text)
    case 'assistant-thinking':
      return '(rozumowanie)'
    case 'tool-use':
      return `${String(d.name)} ${toolSummary(d.input)}`
    case 'tool-result':
      return d.isError ? 'błąd narzędzia' : 'wynik narzędzia'
    case 'result':
      return '— koniec tury —'
    case 'error':
      return String(d.message ?? d.stderr ?? 'błąd')
    default:
      return ''
  }
}

export function GridView({
  sessions,
  eventsOf,
  onOpen,
  onAct,
}: {
  sessions: LiveSessionInfo[]
  eventsOf: (id: string) => LiveEvent[]
  onOpen: (id: string) => void
  onAct: (id: string, body: Record<string, unknown>) => void
}) {
  if (!sessions.length) {
    return (
      <p className="py-16 text-center text-sm muted">
        Brak sesji. Alt+N uruchamia nową, Alt+R wznawia zapisaną.
      </p>
    )
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {sessions.map((s) => {
        const tail = eventsOf(s.id)
          .map(line)
          .filter(Boolean)
          .slice(-6)
        return (
          <div
            key={s.id}
            className="flex flex-col rounded-xl px-3 py-2.5"
            style={{
              background: 'var(--panel)',
              border: `1px solid ${s.pending.length ? 'var(--warn)' : 'var(--border)'}`,
            }}
          >
            <button onClick={() => onOpen(s.id)} className="text-left">
              <div className="truncate text-xs font-medium">{s.title}</div>
              <div className="flex flex-wrap items-center gap-x-2 text-[10px] muted">
                <StatusDot status={s.status} />
                <span className="mono truncate">{shortenPath(s.cwd, 2)}</span>
                <span>{fmtRelative(s.lastEventAt)}</span>
              </div>
            </button>

            <div
              className="mt-2 min-h-[4.5rem] flex-1 space-y-0.5 overflow-hidden rounded p-2 text-[10px] mono"
              style={{ background: 'var(--bg)', color: 'var(--muted)' }}
            >
              {tail.length ? (
                tail.map((t, i) => (
                  <div key={i} className="truncate">
                    {t}
                  </div>
                ))
              ) : (
                <div>—</div>
              )}
            </div>

            {s.pending.length ? (
              <div className="mt-2">
                <div className="truncate text-[11px]" style={{ color: 'var(--warn)' }}>
                  czeka: <span className="mono">{s.pending[0].ruleKey}</span>
                </div>
                <div className="mt-1 flex gap-1.5">
                  <Button
                    variant="primary"
                    onClick={() =>
                      onAct(s.id, {
                        action: 'permission',
                        permissionId: s.pending[0].id,
                        decision: 'allow',
                      })
                    }
                  >
                    Zezwól
                  </Button>
                  <Button
                    onClick={() =>
                      onAct(s.id, {
                        action: 'permission',
                        permissionId: s.pending[0].id,
                        decision: 'allow-always',
                      })
                    }
                  >
                    Zawsze
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() =>
                      onAct(s.id, {
                        action: 'permission',
                        permissionId: s.pending[0].id,
                        decision: 'deny',
                      })
                    }
                  >
                    Odrzuć
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-2 flex gap-1.5">
                <Button onClick={() => onOpen(s.id)}>Otwórz</Button>
                {s.status === 'running' ? (
                  <Button onClick={() => onAct(s.id, { action: 'interrupt' })}>Przerwij</Button>
                ) : null}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
