'use client'

import { useState } from 'react'

import { McpPanel } from '@/components/McpPanel'
import { ReposPanel } from '@/components/ReposPanel'
import { WorkspacesPanel } from '@/components/WorkspacesPanel'

const TABS = [
  { key: 'workspaces', label: 'Przestrzenie' },
  { key: 'repos', label: 'Repozytoria' },
  { key: 'mcp', label: 'Serwery MCP' },
] as const

export function WorkspacesTabs() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('workspaces')
  // Wymusza przeładowanie paneli po zmianach w innych zakładkach.
  const [nonce, setNonce] = useState(0)
  const bump = () => setNonce((n) => n + 1)

  return (
    <div className="mx-auto max-w-5xl space-y-4 2xl:max-w-[90rem]">
      <header>
        <h1 className="text-xl font-semibold">Przestrzenie robocze</h1>
        <p className="mt-1 text-sm muted">
          Wepnij repozytoria i serwery MCP, a potem złóż z nich przestrzeń, z której startujesz sesje.
        </p>
      </header>

      <div className="flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="rounded-lg px-3 py-1.5 text-sm"
            style={{
              background: tab === t.key ? 'var(--accent-soft)' : 'var(--panel)',
              color: tab === t.key ? 'var(--accent)' : 'var(--text)',
              border: `1px solid ${tab === t.key ? 'var(--accent)' : 'var(--border)'}`,
              fontWeight: tab === t.key ? 600 : 400,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'workspaces' ? <WorkspacesPanel key={nonce} /> : null}
      {tab === 'repos' ? <ReposPanel onChanged={bump} /> : null}
      {tab === 'mcp' ? <McpPanel onChanged={bump} /> : null}
    </div>
  )
}
