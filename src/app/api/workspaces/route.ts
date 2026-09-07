import { handle } from '@/lib/api'
import { mutateStore, newId, readStore, type WorkspaceEntry } from '@/lib/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  return handle(req, async () => {
    const data = await readStore()
    const items = data.workspaces.map((w) => ({
      ...w,
      primary: data.repos.find((r) => r.id === w.primaryRepoId),
      extras: w.extraRepoIds
        .map((id) => data.repos.find((r) => r.id === id))
        .filter((r) => r !== undefined),
      mcp: w.mcpIds
        .map((id) => data.mcpServers.find((m) => m.id === id))
        .filter((m) => m !== undefined),
    }))
    return { items }
  })
}

export async function POST(req: Request) {
  return handle(req, async () => {
    const body = (await req.json()) as Partial<WorkspaceEntry>
    if (!body.name?.trim()) throw new Error('Brak nazwy przestrzeni')
    if (!body.primaryRepoId) throw new Error('Wskaż repozytorium główne')

    const entry: WorkspaceEntry = {
      id: newId(),
      name: body.name.trim(),
      primaryRepoId: body.primaryRepoId,
      extraRepoIds: (body.extraRepoIds ?? []).filter((id) => id !== body.primaryRepoId),
      mcpIds: body.mcpIds ?? [],
      model: body.model || undefined,
      permissionMode: body.permissionMode || undefined,
      allowedTools: body.allowedTools ?? [],
      createdAt: Date.now(),
    }

    await mutateStore((data) => {
      if (!data.repos.some((r) => r.id === entry.primaryRepoId)) {
        throw new Error('Repozytorium główne nie istnieje')
      }
      data.workspaces.push(entry)
    })

    return entry
  })
}
