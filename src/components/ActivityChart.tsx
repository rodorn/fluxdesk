import { fmtUsd } from '@/lib/format'

type Day = { date: string; sessions: number; costUsd: number }

/**
 * Aktywność dzienna — jedna seria, jeden odcień (bez legendy: tytuł nazywa serię).
 * Słupki zakotwiczone w linii bazowej, zaokrąglone końce, 2 px odstępu między nimi.
 */
export function ActivityChart({ daily, days = 45 }: { daily: Day[]; days?: number }) {
  const byDate = new Map(daily.map((d) => [d.date, d]))
  const today = new Date()
  const series: Day[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    series.push(byDate.get(key) ?? { date: key, sessions: 0, costUsd: 0 })
  }
  const max = Math.max(1, ...series.map((d) => d.sessions))

  return (
    <div className="panel px-4 py-4">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Sesje dziennie</h2>
        <span className="text-xs muted">ostatnie {days} dni</span>
      </div>
      <div className="flex h-32 items-end gap-[2px]" role="img" aria-label="Wykres sesji dziennie">
        {series.map((d) => {
          const h = d.sessions === 0 ? 2 : Math.max(4, Math.round((d.sessions / max) * 118))
          return (
            <div
              key={d.date}
              className="group relative min-w-0 flex-1"
              style={{ height: `${h}px` }}
              title={`${d.date}: ${d.sessions} sesji · ${fmtUsd(d.costUsd)}`}
            >
              <div
                className="h-full w-full rounded-t-[4px] transition-opacity group-hover:opacity-80"
                style={{
                  background: d.sessions === 0 ? 'var(--border)' : 'var(--accent)',
                }}
              />
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex justify-between text-[11px] muted">
        <span>{series[0]?.date}</span>
        <span>maks. {max} / dzień</span>
        <span>{series.at(-1)?.date}</span>
      </div>
    </div>
  )
}
