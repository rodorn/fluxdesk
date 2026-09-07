import { handle } from '@/lib/api'
import { computeStats } from '@/lib/transcript'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  return handle(req, () => computeStats())
}
