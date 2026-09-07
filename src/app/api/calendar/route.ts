import { handle } from '@/lib/api'
import { connectionStatus, saveConfig, type Provider } from '@/lib/calendar-oauth'
import {
  addBlock,
  deleteBlock,
  deleteSource,
  listEvents,
  listSources,
  moveBlock,
  saveSource,
} from '@/lib/calendar'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(req: Request) {
  return handle(req, async () => {
    const params = new URL(req.url).searchParams
    if (params.get('view') === 'sources') {
      return { sources: await listSources(), connections: await connectionStatus() }
    }

    // Domyślnie tydzień od dziś; panel i tak zwykle pyta o konkretny zakres.
    const from = Number(params.get('from') ?? Date.now())
    const to = Number(params.get('to') ?? from + 7 * 86_400_000)
    return { events: await listEvents(from, to), sources: await listSources() }
  })
}

export async function POST(req: Request) {
  return handle(req, async () => {
    const body = (await req.json()) as {
      action: 'block' | 'move' | 'unblock' | 'source' | 'unsource' | 'config'
      id?: string
      title?: string
      start?: number
      end?: number
      taskId?: string
      source?: { id?: string; name?: string; url?: string; color?: string; enabled?: boolean }
      provider?: Provider
      config?: { clientId: string; clientSecret: string; tenant?: string }
    }

    switch (body.action) {
      case 'block':
        if (!body.title || !body.start || !body.end) throw new Error('Podaj tytuł i godziny')
        return addBlock({
          title: body.title,
          start: body.start,
          end: body.end,
          taskId: body.taskId,
        })
      case 'move':
        if (!body.id || !body.start || !body.end) throw new Error('Podaj blok i godziny')
        await moveBlock(body.id, body.start, body.end)
        return { ok: true }
      case 'unblock':
        if (!body.id) throw new Error('Podaj blok')
        await deleteBlock(body.id)
        return { ok: true }
      case 'source':
        return { sources: await saveSource(body.source ?? {}) }
      case 'config': {
        if (!body.provider || !body.config?.clientId || !body.config.clientSecret) {
          throw new Error('Podaj dostawcę, identyfikator klienta i klucz tajny')
        }
        await saveConfig(body.provider, body.config)
        return { ok: true, next: `/api/calendar/oauth/${body.provider}` }
      }
      case 'unsource':
        if (!body.id) throw new Error('Podaj źródło')
        return { sources: await deleteSource(body.id) }
      default:
        throw new Error('Nieznana akcja')
    }
  })
}
