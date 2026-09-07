'use client'

/** Wspólne, drobne elementy UI — jedno miejsce na style pól i przycisków. */

export const fieldStyle: React.CSSProperties = {
  background: 'var(--panel)',
  border: '1px solid var(--border)',
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs muted">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] muted">{hint}</span> : null}
    </label>
  )
}

export function Input(
  props: React.InputHTMLAttributes<HTMLInputElement> & {
    ref?: React.Ref<HTMLInputElement>
  }
) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg px-3 py-2 text-sm outline-none ${props.className ?? ''}`}
      style={{ ...fieldStyle, ...props.style }}
    />
  )
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-lg px-3 py-2 text-sm ${props.className ?? ''}`}
      style={{ ...fieldStyle, ...props.style }}
    />
  )
}

export function Button({
  variant = 'ghost',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger'
}) {
  const style: React.CSSProperties =
    variant === 'primary'
      ? { border: '1px solid transparent' }
      : variant === 'danger'
        ? { ...fieldStyle, color: 'var(--err)' }
        : fieldStyle
  return (
    <button
      {...props}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
        variant === 'primary' ? 'btn-gradient' : ''
      } ${props.className ?? ''}`}
      style={{ ...style, ...props.style }}
    />
  )
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'ok' | 'warn' | 'err' | 'accent'
}) {
  const color =
    tone === 'ok'
      ? 'var(--ok)'
      : tone === 'warn'
        ? 'var(--warn)'
        : tone === 'err'
          ? 'var(--err)'
          : tone === 'accent'
            ? 'var(--accent)'
            : 'var(--muted)'
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-medium"
      style={{ background: 'var(--panel-2)', color }}
    >
      {children}
    </span>
  )
}

export function ErrorText({ children }: { children?: React.ReactNode }) {
  if (!children) return null
  return (
    <p className="text-xs" style={{ color: 'var(--err)' }}>
      {children}
    </p>
  )
}
