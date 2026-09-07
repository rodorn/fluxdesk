import { handle } from '@/lib/api'
import { attentionReport, recordActivity, setGoal, updateSettings } from '@/lib/attention'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  return handle(req, () => attentionReport())
}

export async function POST(req: Request) {
  return handle(req, async () => {
    const body = (await req.json()) as {
      action: 'activity' | 'goal' | 'settings'
      kind?: 'switch' | 'work'
      goal?: string
      done?: boolean
      settings?: Record<string, number>
    }

    if (body.action === 'activity') {
      await recordActivity(body.kind ?? 'work')
      return { ok: true }
    }
    if (body.action === 'goal') return setGoal(body.goal ?? '', body.done)
    if (body.action === 'settings') return updateSettings(body.settings ?? {})
    throw new Error('Nieznana akcja')
  })
}
