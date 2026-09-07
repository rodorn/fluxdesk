import { handle } from '@/lib/api'
import { mutateStore, newId, readStore, type McpEntry, type McpTransport } from '@/lib/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/

export async function GET(req: Request) {
  return handle(req, async () => {
    const { mcpServers } = await readStore()
    return { items: mcpServers }
  })
}

export async function POST(req: Request) {
  return handle(req, async () => {
    const body = (await req.json()) as Partial<McpEntry>
    const name = body.name?.trim()
    if (!name || !NAME_RE.test(name)) {
      throw new Error('Nazwa serwera: litery, cyfry, myślnik lub podkreślenie (do 64 znaków)')
    }
    const transport = (body.transport ?? 'stdio') as McpTransport
    if (transport === 'stdio' && !body.command?.trim()) throw new Error('Brak polecenia (command)')
    if (transport !== 'stdio' && !body.url?.trim()) throw new Error('Brak adresu URL')

    const entry: McpEntry = {
      id: newId(),
      name,
      transport,
      command: body.command?.trim(),
      args: body.args ?? [],
      env: body.env ?? {},
      url: body.url?.trim(),
      headers: body.headers ?? {},
      enabled: body.enabled ?? true,
      createdAt: Date.now(),
    }

    await mutateStore((data) => {
      if (data.mcpServers.some((m) => m.name === name)) {
        throw new Error('Serwer o tej nazwie już istnieje')
      }
      data.mcpServers.push(entry)
    })

    return entry
  })
}
