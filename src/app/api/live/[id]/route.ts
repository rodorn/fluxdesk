import { fail, guard, handle } from '@/lib/api'
import { getLiveSession, removeLiveSession, restartLiveSession } from '@/lib/runner'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx) {
  const denied = guard(req)
  if (denied) return denied
  const { id } = await ctx.params
  const session = getLiveSession(id)
  if (!session) return fail('Nie znaleziono sesji na żywo', 404)
  const cursor = Number(new URL(req.url).searchParams.get('cursor') ?? '-1')
  return Response.json({ info: session.info(), events: session.eventsSince(cursor) })
}

export async function POST(req: Request, ctx: Ctx) {
  return handle(req, async () => {
    const { id } = await ctx.params
    const session = getLiveSession(id)
    if (!session) throw new Error('Nie znaleziono sesji na żywo')

    const body = (await req.json()) as {
      action:
        | 'send'
        | 'interrupt'
        | 'permission'
        | 'permissionMode'
        | 'unqueue'
        | 'revokeAutoAllow'
        | 'restart'
      text?: string
      images?: string[]
      permissionId?: string
      decision?: 'allow' | 'allow-always' | 'deny'
      message?: string
      mode?: string
      index?: number
      ruleKey?: string
    }

    switch (body.action) {
      case 'send':
        if (!body.text?.trim() && !body.images?.length) throw new Error('Pusta wiadomość')
        session.send(body.text ?? '', body.images ?? [])
        break
      case 'interrupt':
        await session.interrupt()
        break
      case 'permission':
        if (!body.permissionId || !body.decision) throw new Error('Brak decyzji')
        if (!session.resolvePermission(body.permissionId, body.decision, body.message)) {
          throw new Error('Prośba o uprawnienie już nieaktualna')
        }
        break
      case 'permissionMode':
        if (!body.mode) throw new Error('Brak trybu')
        await session.setPermissionMode(body.mode)
        break
      case 'unqueue':
        session.unqueue(body.index)
        break
      case 'revokeAutoAllow':
        if (!body.ruleKey) throw new Error('Brak reguły')
        session.revokeAutoAllow(body.ruleKey)
        break
      case 'restart': {
        if (!body.text?.trim()) throw new Error('Podaj prompt startowy')
        const fresh = await restartLiveSession(id, body.text)
        return fresh.info()
      }
      default:
        throw new Error('Nieznana akcja')
    }
    return session.info()
  })
}

export async function DELETE(req: Request, ctx: Ctx) {
  return handle(req, async () => {
    const { id } = await ctx.params
    return { ok: removeLiveSession(id) }
  })
}
