import { handle } from '@/lib/api'
import { probeMcpServer } from '@/lib/mcp-probe'
import { readStore } from '@/lib/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async () => {
    const { id } = await ctx.params
    const { mcpServers } = await readStore()
    const entry = mcpServers.find((m) => m.id === id)
    if (!entry) throw new Error('Nie znaleziono serwera MCP')
    return await probeMcpServer(entry)
  })
}
