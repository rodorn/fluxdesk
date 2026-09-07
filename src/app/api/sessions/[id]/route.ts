import { fail, guard, handle } from '@/lib/api'
import { deleteSession, renameSession, tagSession } from '@/lib/sessions'
import { readSessionDetail } from '@/lib/transcript'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx) {
  const denied = guard(req)
  if (denied) return denied
  const { id } = await ctx.params
  const url = new URL(req.url)
  const includeSidechains = url.searchParams.get('sidechains') === '1'
  const detail = await readSessionDetail(id, { includeSidechains })
  if (!detail) return fail('Nie znaleziono sesji', 404)
  return Response.json(detail)
}

export async function PATCH(req: Request, ctx: Ctx) {
  return handle(req, async () => {
    const { id } = await ctx.params
    const body = (await req.json()) as { title?: string; tag?: string | null }
    if (typeof body.title === 'string') await renameSession(id, body.title)
    if (body.tag !== undefined) await tagSession(id, body.tag)
    return { ok: true }
  })
}

export async function DELETE(req: Request, ctx: Ctx) {
  return handle(req, async () => {
    const { id } = await ctx.params
    await deleteSession(id)
    return { ok: true }
  })
}
