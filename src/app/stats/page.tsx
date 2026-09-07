import Link from 'next/link'

import { ActivityChart } from '@/components/ActivityChart'
import { BarList } from '@/components/BarList'
import { StatTile } from '@/components/StatTile'
import { fmtRelative, fmtTokens, fmtUsd, shortenPath } from '@/lib/format'
import { computeStats } from '@/lib/transcript'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function StatsPage() {
  const stats = await computeStats()
  const total = stats.usage.input + stats.usage.output + stats.usage.cacheCreate + stats.usage.cacheRead

  const topTools = Object.entries(stats.toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([label, value]) => ({ label, value }))

  const models = Object.entries(stats.modelCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, value]) => ({ label: label.replace(/^claude-/, ''), value }))

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-8 2xl:max-w-[100rem]">
      <header>
        <h1 className="text-xl font-semibold">Statystyki</h1>
        <p className="mt-1 text-sm muted">
          Dane odczytane z lokalnych transkryptów Claude Code (~/.claude/projects).
        </p>
      </header>

      {stats.sessionCount === 0 ? (
        <div className="panel px-5 py-8 text-center">
          <p className="text-sm">Nie znaleziono żadnych transkryptów sesji.</p>
          <p className="mt-2 text-xs muted">
            Sprawdź, czy panel działa na tej samej maszynie co Claude Code, albo ustaw
            <code className="mono"> CLAUDE_CONFIG_DIR</code>.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Sesje" value={String(stats.sessionCount)} />
        <StatTile label="Projekty" value={String(stats.projectCount)} />
        <StatTile
          label="Tokeny"
          value={fmtTokens(total)}
          hint={`${fmtTokens(stats.usage.cacheRead)} z cache`}
        />
        <StatTile label="Koszt (szacunek)" value={fmtUsd(stats.totalCostUsd)} />
      </div>

      <ActivityChart daily={stats.daily} />

      <div className="grid gap-4 lg:grid-cols-2">
        <BarList title="Najczęściej używane narzędzia" items={topTools} />
        <BarList title="Modele" items={models} formatValue={(n) => `${n} sesji`} />
      </div>

      <section className="panel overflow-hidden">
        <h2 className="border-b px-4 py-3 text-sm font-semibold" style={{ borderColor: 'var(--border)' }}>
          Projekty
        </h2>
        <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
          {stats.projects.slice(0, 20).map((p) => (
            <li key={p.cwd}>
              <Link
                href={`/sessions?cwd=${encodeURIComponent(p.cwd)}`}
                className="flex items-center justify-between gap-4 px-4 py-3 text-sm hover:opacity-80"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{p.name}</div>
                  <div className="truncate text-xs muted mono wrap-anywhere">
                    {shortenPath(p.cwd, 4)}
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs muted tabular-nums">
                  <div>
                    {p.sessionCount} sesji · {fmtUsd(p.totalCostUsd)}
                  </div>
                  <div>{fmtRelative(p.lastActivity)}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
