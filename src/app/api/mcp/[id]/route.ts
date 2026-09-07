import { handle } from '@/lib/api'
import { mutateStore, type McpEntry } from '@/lib/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, ctx: Ctx) {
  return handle(req, async () => {
    const { id } = await ctx.params
    const body = (await req.json()) as Partial<McpEntry>
    await mutateStore((data) => {
      const entry = data.mcpServers.find((m) => m.id === id)
      if (!entry) throw new Error('Nie znaleziono serwera MCP')
      for (const key of ['command', 'url', 'transport'] as const) {
        if (body[key] !== undefined) entry[key] = body[key] as never
      }
      if (body.args !== undefined) entry.args = body.args
      if (body.env !== undefined) entry.env = body.env
      if (body.headers !== undefined) entry.headers = body.headers
      if (body.enabled !== undefined) entry.enabled = body.enabled
      if (body.name !== undefined) {
        const name = body.name.trim()
        if (data.mcpServers.some((m) => m.name === name && m.id !== id)) {
          throw new Error('Serwer o tej nazwie już istnieje')
        }
        entry.name = name
      }
    })
    return { ok: true }
  })
}

export async function DELETE(req: Request, ctx: Ctx) {
  return handle(req, async () => {
    const { id } = await ctx.params
    await mutateStore((data) => {
      data.mcpServers = data.mcpServers.filter((m) => m.id !== id)
      for (const w of data.workspaces) w.mcpIds = w.mcpIds.filter((mid) => mid !== id)
    })
    return { ok: true }
  })
}
