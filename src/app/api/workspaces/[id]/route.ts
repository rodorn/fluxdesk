import { handle } from '@/lib/api'
import { mutateStore, type WorkspaceEntry } from '@/lib/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, ctx: Ctx) {
  return handle(req, async () => {
    const { id } = await ctx.params
    const body = (await req.json()) as Partial<WorkspaceEntry>
    await mutateStore((data) => {
      const w = data.workspaces.find((x) => x.id === id)
      if (!w) throw new Error('Nie znaleziono przestrzeni')
      if (body.name !== undefined) w.name = body.name.trim() || w.name
      if (body.primaryRepoId !== undefined) w.primaryRepoId = body.primaryRepoId
      if (body.extraRepoIds !== undefined) {
        w.extraRepoIds = body.extraRepoIds.filter((rid) => rid !== w.primaryRepoId)
      }
      if (body.mcpIds !== undefined) w.mcpIds = body.mcpIds
      if (body.model !== undefined) w.model = body.model || undefined
      if (body.permissionMode !== undefined) w.permissionMode = body.permissionMode || undefined
      if (body.allowedTools !== undefined) w.allowedTools = body.allowedTools
    })
    return { ok: true }
  })
}

export async function DELETE(req: Request, ctx: Ctx) {
  return handle(req, async () => {
    const { id } = await ctx.params
    await mutateStore((data) => {
      data.workspaces = data.workspaces.filter((w) => w.id !== id)
    })
    return { ok: true }
  })
}
