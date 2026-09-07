import { handle } from '@/lib/api'
import { revealSecret } from '@/lib/secrets'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

type Cache = { at: number; data: unknown }
const ref = globalThis as unknown as { __csmCarmore?: Cache }
const TTL_MS = 300_000

/**
 * Liczby Carmore, do których i tak wracasz co tydzień. Panel czyta je przez
 * ten sam token, który leży w sejfie, i nie przechowuje ich dłużej niż pięć minut.
 */
async function pipedrive(): Promise<{ configured: boolean; deals?: number; stale?: number }> {
  let token: string
  try {
    token = await revealSecret('pipedrive/token')
  } catch {
    return { configured: false }
  }

  try {
    const res = await fetch(
      `https://${process.env.CSM_PIPEDRIVE_HOST ?? 'api'}.pipedrive.com/api/v1/deals?status=open&limit=100&api_token=${token}`,
      { signal: AbortSignal.timeout(8000) }
    )
    if (!res.ok) return { configured: true }
    const json = (await res.json()) as { data?: { update_time?: string }[] }
    const deals = json.data ?? []
    const week = Date.now() - 7 * 86_400_000

    return {
      configured: true,
      deals: deals.length,
      // Szanse bez ruchu od tygodnia to zwykle te, które cicho umierają.
      stale: deals.filter((d) => (d.update_time ? Date.parse(d.update_time) < week : false)).length,
    }
  } catch {
    return { configured: true }
  }
}

export async function GET(req: Request) {
  return handle(req, async () => {
    const cached = ref.__csmCarmore
    if (cached && Date.now() - cached.at < TTL_MS) return cached.data
    const data = { pipedrive: await pipedrive() }
    ref.__csmCarmore = { at: Date.now(), data }
    return data
  })
}
