import { handle } from '@/lib/api'
import { buildBilling, buildJournal, buildWeek } from '@/lib/journal'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  return handle(req, async () => {
    const params = new URL(req.url).searchParams
    if (params.get('range') === 'week') return buildWeek()
    if (params.get('range') === 'billing') {
      return buildBilling(Number(params.get('days') ?? 30))
    }
    return buildJournal(params.get('date') || undefined)
  })
}
