export function StatTile({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="panel px-4 py-3">
      <div className="text-[11px] tracking-wide uppercase muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="mt-0.5 text-xs muted">{hint}</div> : null}
    </div>
  )
}
