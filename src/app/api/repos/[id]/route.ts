import { handle } from '@/lib/api'
import { mutateStore } from '@/lib/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, ctx: Ctx) {
  return handle(req, async () => {
    const { id } = await ctx.params
    const body = (await req.json()) as { name?: string; tags?: string[] }
    await mutateStore((data) => {
      const repo = data.repos.find((r) => r.id === id)
      if (!repo) throw new Error('Nie znaleziono repozytorium')
      if (body.name !== undefined) repo.name = body.name.trim() || repo.name
      if (body.tags !== undefined) repo.tags = body.tags
    })
    return { ok: true }
  })
}

export async function DELETE(req: Request, ctx: Ctx) {
  return handle(req, async () => {
    const { id } = await ctx.params
    await mutateStore((data) => {
      const used = data.workspaces.filter(
        (w) => w.primaryRepoId === id || w.extraRepoIds.includes(id)
      )
      if (used.length) {
        throw new Error(
          `Repozytorium jest używane w przestrzeniach: ${used.map((w) => w.name).join(', ')}`
        )
      }
      data.repos = data.repos.filter((r) => r.id !== id)
    })
    return { ok: true }
  })
}
