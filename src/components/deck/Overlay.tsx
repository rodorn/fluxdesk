'use client'

import { useEffect } from 'react'

/** Wspólna ramka dla okien nakładkowych — zamykana Esc, klik w tło też zamyka. */
export function Overlay({
  title,
  hint,
  onClose,
  children,
  wide,
}: {
  title: string
  hint?: string
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[8vh]"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="flex max-h-[80vh] w-full flex-col overflow-hidden rounded-xl"
        style={{
          maxWidth: wide ? '56rem' : '38rem',
          background: 'var(--panel)',
          border: '1px solid var(--border)',
        }}
      >
        <div
          className="flex items-baseline justify-between gap-3 border-b px-4 py-2.5"
          style={{ borderColor: 'var(--border)' }}
        >
          <h2 className="text-sm font-semibold">{title}</h2>
          {hint ? <span className="text-[11px] muted">{hint}</span> : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}
