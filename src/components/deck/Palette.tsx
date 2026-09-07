'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { Overlay } from '@/components/deck/Overlay'

export type Command = {
  id: string
  label: string
  hint?: string
  keys?: string
  run: () => void
}

/** Paleta poleceń — jedno miejsce na wszystko, co da się zrobić w pulpicie. */
export function Palette({
  commands,
  onClose,
  title = 'Polecenia',
  placeholder = 'Szukaj polecenia albo sesji…',
}: {
  commands: Command[]
  onClose: () => void
  title?: string
  placeholder?: string
}) {
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
  }, [])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return commands
    return commands.filter((c) =>
      `${c.label} ${c.hint ?? ''}`.toLowerCase().includes(needle)
    )
  }, [commands, q])

  useEffect(() => {
    setCursor(0)
  }, [q])

  return (
    <Overlay title={title} hint="↑↓ · Enter · Esc" onClose={onClose}>
      <input
        ref={input}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setCursor((c) => Math.min(c + 1, filtered.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setCursor((c) => Math.max(c - 1, 0))
          } else if (e.key === 'Enter' && filtered[cursor]) {
            e.preventDefault()
            onClose()
            filtered[cursor].run()
          }
        }}
        placeholder={placeholder}
        className="mb-3 w-full rounded-lg px-3 py-2 text-sm outline-none"
        style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
      />
      <ul className="space-y-0.5">
        {filtered.map((c, i) => (
          <li key={c.id}>
            <button
              onMouseEnter={() => setCursor(i)}
              onClick={() => {
                onClose()
                c.run()
              }}
              className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-left"
              style={{
                background: i === cursor ? 'var(--accent-soft)' : 'transparent',
                border: `1px solid ${i === cursor ? 'var(--accent)' : 'transparent'}`,
              }}
            >
              <span className="min-w-0">
                <span className="block truncate text-xs">{c.label}</span>
                {c.hint ? <span className="block truncate text-[10px] muted">{c.hint}</span> : null}
              </span>
              {c.keys ? <span className="shrink-0 text-[10px] mono muted">{c.keys}</span> : null}
            </button>
          </li>
        ))}
        {filtered.length === 0 ? (
          <li className="py-6 text-center text-sm muted">Nic nie pasuje.</li>
        ) : null}
      </ul>
    </Overlay>
  )
}
