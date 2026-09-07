import { handle } from '@/lib/api'
import { listSessions, type SessionFilter } from '@/lib/sessions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  return handle(req, async () => {
    const url = new URL(req.url)
    const filter: SessionFilter = {
      cwd: url.searchParams.get('cwd') || undefined,
      q: url.searchParams.get('q') || undefined,
      sort: (url.searchParams.get('sort') as SessionFilter['sort']) || 'recent',
      limit: Number(url.searchParams.get('limit') || 50),
      offset: Number(url.searchParams.get('offset') || 0),
    }
    return await listSessions(filter)
  })
}
