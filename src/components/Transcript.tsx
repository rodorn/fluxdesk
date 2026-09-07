'use client'

import { useMemo, useState } from 'react'

import { fmtTokens, fmtUsd } from '@/lib/format'
import type { ContentBlock, TranscriptEntry } from '@/lib/types'

function Collapsible({
  header,
  children,
  defaultOpen = false,
  tone = 'default',
}: {
  header: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
  tone?: 'default' | 'error'
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div
      className="rounded-lg"
      style={{
        background: 'var(--panel-2)',
        border: `1px solid ${tone === 'error' ? 'var(--err)' : 'var(--border)'}`,
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
      >
        <span className="muted">{open ? '▾' : '▸'}</span>
        {header}
      </button>
      {open ? <div className="px-3 pb-3">{children}</div> : null}
    </div>
  )
}

function Pre({ children }: { children: string }) {
  return (
    <pre
      className="max-h-96 overflow-auto rounded-md p-2 text-[11px] leading-relaxed mono"
      style={{ background: 'var(--bg)' }}
    >
      {children}
    </pre>
  )
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

function toolSummary(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const o = input as Record<string, unknown>
  const first = o.file_path ?? o.path ?? o.command ?? o.pattern ?? o.url ?? o.prompt
  if (typeof first === 'string') return first.length > 90 ? first.slice(0, 90) + '…' : first
  return ''
}

function Block({ block }: { block: ContentBlock }) {
  if (block.type === 'text') {
    const text = String((block as { text?: unknown }).text ?? '')
    if (!text.trim()) return null
    return <div className="text-sm whitespace-pre-wrap wrap-anywhere">{text}</div>
  }

  if (block.type === 'thinking') {
    const text = String((block as { thinking?: unknown }).thinking ?? '')
    return (
      <Collapsible header={<span className="muted italic">rozumowanie ({text.length} zn.)</span>}>
        <div className="text-xs whitespace-pre-wrap muted wrap-anywhere">{text}</div>
      </Collapsible>
    )
  }

  if (block.type === 'tool_use') {
    const b = block as unknown as { name?: string; input?: unknown }
    return (
      <Collapsible
        header={
          <>
            <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
              {b.name}
            </span>
            <span className="truncate mono muted">{toolSummary(b.input)}</span>
          </>
        }
      >
        <Pre>{stringify(b.input)}</Pre>
      </Collapsible>
    )
  }

  if (block.type === 'tool_result') {
    const b = block as unknown as { content?: unknown; is_error?: boolean }
    const text = stringify(b.content)
    return (
      <Collapsible
        tone={b.is_error ? 'error' : 'default'}
        header={
          <span className="muted">
            {b.is_error ? 'błąd narzędzia' : 'wynik narzędzia'} · {text.length} zn.
          </span>
        }
      >
        <Pre>{text}</Pre>
      </Collapsible>
    )
  }

  if (block.type === 'image') {
    return <div className="text-xs muted">[obraz]</div>
  }

  return (
    <Collapsible header={<span className="muted">{block.type}</span>}>
      <Pre>{stringify(block)}</Pre>
    </Collapsible>
  )
}

const ROLE_LABEL: Record<string, string> = {
  user: 'Użytkownik',
  assistant: 'Claude',
  system: 'System',
}

function Entry({ entry }: { entry: TranscriptEntry }) {
  const isUser = entry.role === 'user'
  const onlyToolResults =
    entry.blocks.length > 0 && entry.blocks.every((b) => b.type === 'tool_result')

  return (
    <article
      className="rounded-xl px-4 py-3"
      style={{
        background: isUser && !onlyToolResults ? 'var(--accent-soft)' : 'var(--panel)',
        border: '1px solid var(--border)',
      }}
    >
      <header className="mb-2 flex flex-wrap items-center gap-2 text-[11px] muted">
        <span className="font-semibold" style={{ color: isUser ? 'var(--accent)' : 'var(--text)' }}>
          {onlyToolResults ? 'Narzędzia' : (ROLE_LABEL[entry.role] ?? entry.role)}
        </span>
        {entry.timestamp ? (
          <time>{new Date(entry.timestamp).toLocaleTimeString('pl-PL')}</time>
        ) : null}
        {entry.model ? <span className="mono">{entry.model.replace(/^claude-/, '')}</span> : null}
        {entry.usage ? (
          <span>
            {fmtTokens(entry.usage.input + entry.usage.cacheRead + entry.usage.cacheCreate)} in ·{' '}
            {fmtTokens(entry.usage.output)} out
          </span>
        ) : null}
        {entry.costUsd ? <span>{fmtUsd(entry.costUsd)}</span> : null}
      </header>
      <div className="space-y-2">
        {entry.blocks.map((b, i) => (
          <Block key={i} block={b} />
        ))}
      </div>
    </article>
  )
}

export function Transcript({ entries }: { entries: TranscriptEntry[] }) {
  const [query, setQuery] = useState('')
  const [hideTools, setHideTools] = useState(false)

  const filtered = useMemo(() => {
    let list = entries
    if (hideTools) {
      list = list
        .map((e) => ({
          ...e,
          blocks: e.blocks.filter((b) => b.type !== 'tool_use' && b.type !== 'tool_result'),
        }))
        .filter((e) => e.blocks.length > 0)
    }
    if (query.trim()) {
      const q = query.toLowerCase()
      list = list.filter((e) => JSON.stringify(e.blocks).toLowerCase().includes(q))
    }
    return list
  }, [entries, hideTools, query])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Szukaj w transkrypcie…"
          className="min-w-0 flex-1 rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: 'var(--panel)', border: '1px solid var(--border)' }}
        />
        <label className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--panel)', border: '1px solid var(--border)' }}>
          <input
            type="checkbox"
            checked={hideTools}
            onChange={(e) => setHideTools(e.target.checked)}
          />
          Ukryj narzędzia
        </label>
      </div>

      <p className="text-xs muted">
        {filtered.length} z {entries.length} wpisów
      </p>

      <div className="space-y-2">
        {filtered.map((e) => (
          <Entry key={e.uuid} entry={e} />
        ))}
      </div>
    </div>
  )
}
