'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const links = [
  { href: '/', label: 'Pulpit', icon: '◉' },
  { href: '/sessions', label: 'Historia', icon: '≡' },
  { href: '/workspaces', label: 'Przestrzenie', icon: '⊞' },
  { href: '/stats', label: 'Statystyki', icon: '◧' },
]

export function Nav() {
  const pathname = usePathname()
  return (
    <nav
      className="shrink-0 border-b md:h-screen md:w-52 md:border-r md:border-b-0"
      style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}
    >
      <div className="flex items-center gap-2.5 px-4 py-4">
        <span className="flux-mark flex h-8 w-8 items-center justify-center rounded-lg">
          <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden="true">
            <path
              d="M9 10h14M9 16h10M9 22h6"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight">Fluxdesk</div>
          <div className="text-[11px] muted">fluxlab</div>
        </div>
      </div>

      <ul className="flex gap-1 px-2 pb-3 md:flex-col md:gap-0.5">
        {links.map((l) => {
          const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href)
          return (
            <li key={l.href} className="flex-1">
              <Link
                href={l.href}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors"
                style={{
                  background: active ? 'var(--accent-soft)' : 'transparent',
                  color: active ? 'var(--accent)' : 'var(--text)',
                  fontWeight: active ? 600 : 400,
                }}
              >
                <span className="w-4 text-center opacity-70">{l.icon}</span>
                {l.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
