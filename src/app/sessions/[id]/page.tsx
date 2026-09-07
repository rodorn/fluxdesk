import Link from 'next/link'
import { notFound } from 'next/navigation'

import { SessionActions } from '@/components/SessionActions'
import { StatTile } from '@/components/StatTile'
import { Transcript } from '@/components/Transcript'
import { fmtDate, fmtTokens, fmtUsd } from '@/lib/format'
import { readSessionDetail } from '@/lib/transcript'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const detail = await readSessionDetail(id)
  if (!detail) notFound()

  const totalTok =
    detail.usage.input + detail.usage.output + detail.usage.cacheCreate + detail.usage.cacheRead
  const topTools = Object.entries(detail.toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-6 md:px-8 2xl:max-w-6xl">
      <header className="space-y-2">
        <Link href="/sessions" className="text-xs muted hover:underline">
          ← Wszystkie sesje
        </Link>
        <h1 className="text-lg font-semibold wrap-anywhere">{detail.title}</h1>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs muted">
          <span className="mono">{detail.sessionId}</span>
          {detail.cwd ? <span className="mono wrap-anywhere">{detail.cwd}</span> : null}
          {detail.gitBranch ? <span>⑂ {detail.gitBranch}</span> : null}
          <span>{fmtDate(detail.createdAt)}</span>
        </div>
        <SessionActions sessionId={detail.sessionId} cwd={detail.cwd} title={detail.title} />
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Wpisy" value={String(detail.entryCount)} />
        <StatTile
          label="Tokeny"
          value={fmtTokens(totalTok)}
          hint={`${fmtTokens(detail.usage.output)} wygenerowanych`}
        />
        <StatTile label="Koszt (szacunek)" value={fmtUsd(detail.costUsd)} />
        <StatTile
          label="Model"
          value={detail.models[0]?.replace(/^claude-/, '') || '—'}
          hint={detail.models.length > 1 ? `+${detail.models.length - 1} inne` : undefined}
        />
      </div>

      {topTools.length ? (
        <div className="panel px-4 py-3">
          <h2 className="mb-2 text-xs font-semibold tracking-wide uppercase muted">
            Użyte narzędzia
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {topTools.map(([name, count]) => (
              <span
                key={name}
                className="rounded-md px-2 py-1 text-[11px] mono"
                style={{ background: 'var(--panel-2)' }}
              >
                {name} <span className="muted">×{count}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <Transcript entries={detail.entries} />
    </div>
  )
}
