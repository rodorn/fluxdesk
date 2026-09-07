import { Suspense } from 'react'

import { Deck } from '@/components/deck/Deck'

export const dynamic = 'force-dynamic'

export default function LivePage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm muted">Wczytywanie pulpitu…</p>}>
      <Deck />
    </Suspense>
  )
}
