export function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + ' mld'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + ' mln'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + ' tys.'
  return String(n)
}

export function fmtUsd(n: number): string {
  if (n === 0) return '$0'
  if (n < 0.01) return '<$0.01'
  return '$' + n.toFixed(n < 10 ? 2 : 0)
}

export function fmtBytes(n?: number): string {
  if (!n) return '—'
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
  if (n >= 1024) return Math.round(n / 1024) + ' KB'
  return n + ' B'
}

export function fmtDate(ms?: number): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function fmtRelative(ms?: number): string {
  if (!ms) return '—'
  const diff = Date.now() - ms
  const s = Math.round(diff / 1000)
  if (s < 60) return 'przed chwilą'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min temu`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} godz. temu`
  const d = Math.round(h / 24)
  if (d < 30) return `${d} dni temu`
  return fmtDate(ms)
}

export function fmtDuration(ms?: number): string {
  if (typeof ms !== 'number') return '—'
  if (ms < 1000) return `${ms} ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)} s`
  const m = Math.floor(s / 60)
  return `${m} min ${Math.round(s % 60)} s`
}

export function shortenPath(p?: string, keep = 3): string {
  if (!p) return '—'
  const parts = p.split('/').filter(Boolean)
  if (parts.length <= keep) return p
  return '…/' + parts.slice(-keep).join('/')
}
