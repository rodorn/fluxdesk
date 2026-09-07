import { handle } from '@/lib/api'
import { notify, readNotifySettings, writeNotifySettings } from '@/lib/notify'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  return handle(req, () => readNotifySettings())
}

export async function PUT(req: Request) {
  return handle(req, async () => {
    const body = (await req.json()) as Record<string, unknown>
    return writeNotifySettings(body)
  })
}

/** Wysyłka próbna, żeby sprawdzić konfigurację bez czekania na prawdziwe zdarzenie. */
export async function POST(req: Request) {
  return handle(req, () =>
    notify({
      title: 'Fluxdesk',
      message: 'Powiadomienia działają. Tak wygląda sygnał z panelu.',
      tags: ['white_check_mark'],
    })
  )
}
