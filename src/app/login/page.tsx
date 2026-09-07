'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * Wejście z telefonu: token trafia do ciasteczka, którego pilnuje `guard()` w API.
 * Panel steruje całym komputerem, więc bez tokenu nie powinien wisieć w sieci lokalnej.
 */
export default function LoginPage() {
  const router = useRouter()
  const [token, setToken] = useState('')

  function save(e: React.FormEvent) {
    e.preventDefault()
    const value = token.trim()
    if (!value) return
    document.cookie = `csm_token=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`
    router.push('/')
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={save} className="panel w-full max-w-sm space-y-3 p-5">
        <h1 className="text-sm font-semibold">Fluxdesk</h1>
        <p className="text-xs muted">
          Wpisz token dostępu (zmienna <span className="mono">CSM_ACCESS_TOKEN</span> na serwerze).
        </p>
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          type="password"
          autoComplete="current-password"
          placeholder="token"
          className="w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
        />
        <button
          type="submit"
          className="w-full rounded-lg px-3 py-2 text-sm font-medium"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          Wejdź
        </button>
      </form>
    </div>
  )
}
