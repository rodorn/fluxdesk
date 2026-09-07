import { handle } from '@/lib/api'
import {
  connectTerminal,
  getTerminal,
  removeTerminal,
  sendToTerminal,
  setTerminalTitle,
  startTerminal,
} from '@/lib/terminals'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  return handle(req, async () => {
    const { id } = await ctx.params
    const term = await getTerminal(id)
    if (!term) throw new Error('Nie znaleziono terminala')

    const body = (await req.json()) as {
      action: 'input' | 'resize' | 'title' | 'clone' | 'record'
      data?: string
      cols?: number
      rows?: number
      title?: string
    }

    switch (body.action) {
      case 'input':
        if (typeof body.data !== 'string') throw new Error('Brak danych')
        await sendToTerminal(id, { t: 'input', d: body.data })
        break
      case 'resize':
        if (!body.cols || !body.rows) throw new Error('Brak rozmiaru')
        await sendToTerminal(id, { t: 'resize', cols: body.cols, rows: body.rows })
        break
      case 'title':
        if (!body.title?.trim()) throw new Error('Brak tytułu')
        return setTerminalTitle(id, body.title)
      case 'clone': {
        // Rozwidlenie rozmowy: druga sesja rusza od tego samego stanu.
        if (!term.sessionId) throw new Error('Ta sesja nie ma jeszcze transkryptu')
        return startTerminal({
          cwd: term.cwd,
          title: `${term.title} (kopia)`,
          model: term.model,
          permissionMode: term.permissionMode,
          resume: term.sessionId,
        })
      }
      case 'record': {
        // Zrzut ekranu terminala do pliku: do pokazania komuś, co się wydarzyło.
        const screen = await new Promise<string>((resolve) => {
          const timer = setTimeout(() => resolve(''), 1500)
          connectTerminal(id, (msg) => {
            if (msg.t !== 'snapshot') return
            clearTimeout(timer)
            resolve(msg.d)
          })
            .then((conn) => setTimeout(() => conn.close(), 1600))
            .catch(() => {
              clearTimeout(timer)
              resolve('')
            })
        })
        return { screen }
      }
      default:
        throw new Error('Nieznana akcja')
    }
    return (await getTerminal(id)) ?? term
  })
}

export async function DELETE(req: Request, ctx: Ctx) {
  return handle(req, async () => {
    const { id } = await ctx.params
    return { ok: await removeTerminal(id) }
  })
}
