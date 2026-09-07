import { Suspense } from 'react'

import { SessionList } from '@/components/SessionList'

export const dynamic = 'force-dynamic'

export default function SessionsPage() {
  return (
    <div className="px-4 py-6 md:px-8">
      <Suspense fallback={<p className="text-sm muted">Wczytywanie…</p>}>
        <SessionList />
      </Suspense>
    </div>
  )
}
