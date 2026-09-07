import { handle } from '@/lib/api'
import { listTerminals, startTerminal } from '@/lib/terminals'
import { startWatchdog, stuckInfo } from '@/lib/watchdog'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Dozorca odpowiada na pytania blokujące sesje i melduje te, które utknęły.
startWatchdog()

export async function GET(req: Request) {
  return handle(req, async () => {
    const items = (await listTerminals()).map((t) => ({ ...t, stuck: stuckInfo(t.id) }))
    return { items }
  })
}

export async function POST(req: Request) {
  return handle(req, async () => {
    const body = (await req.json()) as {
      cwd?: string
      title?: string
      model?: string
      permissionMode?: string
      resume?: string
      cols?: number
      rows?: number
      host?: string
    }
    if (!body.cwd) throw new Error('Podaj katalog roboczy')
    return startTerminal({
      cwd: body.cwd,
      title: body.title,
      model: body.model,
      permissionMode: body.permissionMode,
      resume: body.resume,
      cols: body.cols,
      rows: body.rows,
      host: body.host,
    })
  })
}
