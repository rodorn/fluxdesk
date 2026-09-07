export function BarList({
  title,
  items,
  formatValue = (n: number) => String(n),
  emptyLabel = 'Brak danych',
}: {
  title: string
  items: { label: string; value: number }[]
  formatValue?: (n: number) => string
  emptyLabel?: string
}) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <div className="panel px-4 py-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {items.length === 0 ? (
        <p className="text-xs muted">{emptyLabel}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.label} className="text-xs">
              <div className="mb-1 flex justify-between gap-3">
                <span className="truncate mono">{i.label}</span>
                <span className="shrink-0 tabular-nums muted">{formatValue(i.value)}</span>
              </div>
              <div className="h-1.5 rounded-full" style={{ background: 'var(--panel-2)' }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(2, (i.value / max) * 100)}%`,
                    background: 'var(--accent)',
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
