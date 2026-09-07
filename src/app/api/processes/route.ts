import { handle } from '@/lib/api'
import {
  killExternalSession,
  listExternalSessions,
  warmExternalSessions,
} from '@/lib/processes'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Pierwsze wejście na pulpit ma zastać gotową listę, a nie czekać na skan.
warmExternalSessions()

export async function GET(req: Request) {
  return handle(req, async () => ({ items: await listExternalSessions() }))
}

export async function DELETE(req: Request) {
  return handle(req, async () => {
    const params = new URL(req.url).searchParams
    const pid = Number(params.get('pid'))
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('Nieprawidłowy PID')
    return killExternalSession(pid, params.get('force') === '1')
  })
}
