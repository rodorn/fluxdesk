import { handle } from '@/lib/api'
import { forkSession } from '@/lib/sessions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const { id } = await ctx.params
    const body = (await req.json().catch(() => ({}))) as {
      upToMessageId?: string
      title?: string
    }
    return await forkSession(id, body)
  })
}
