import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { handle } from '@/lib/api'
import { mutateStore, newId, readStore, type McpEntry, type McpTransport } from '@/lib/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Discovered = {
  source: string
  name: string
  transport: McpTransport
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  alreadyAdded: boolean
}

function parseServers(source: string, raw: unknown): Omit<Discovered, 'alreadyAdded'>[] {
  if (!raw || typeof raw !== 'object') return []
  const servers = (raw as Record<string, unknown>).mcpServers
  if (!servers || typeof servers !== 'object') return []

  const out: Omit<Discovered, 'alreadyAdded'>[] = []
  for (const [name, cfgRaw] of Object.entries(servers as Record<string, unknown>)) {
    if (!cfgRaw || typeof cfgRaw !== 'object') continue
    const cfg = cfgRaw as Record<string, unknown>
    const type = (cfg.type as string) || (cfg.url ? 'http' : 'stdio')
    if (type === 'stdio') {
      if (typeof cfg.command !== 'string') continue
      out.push({
        source,
        name,
        transport: 'stdio',
        command: cfg.command,
        args: Array.isArray(cfg.args) ? (cfg.args as string[]) : [],
        env: (cfg.env as Record<string, string>) ?? {},
      })
    } else if (type === 'http' || type === 'sse') {
      if (typeof cfg.url !== 'string') continue
      out.push({
        source,
        name,
        transport: type,
        url: cfg.url,
        headers: (cfg.headers as Record<string, string>) ?? {},
      })
    }
  }
  return out
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'))
  } catch {
    return undefined
  }
}

/** Wyszukuje definicje MCP w .mcp.json dodanych repozytoriów i w ~/.claude.json. */
export async function GET(req: Request) {
  return handle(req, async () => {
    const store = await readStore()
    const existing = new Set(store.mcpServers.map((m) => m.name))

    const sources: { label: string; file: string }[] = [
      { label: '~/.claude.json', file: path.join(os.homedir(), '.claude.json') },
      ...store.repos.map((r) => ({
        label: `${r.name}/.mcp.json`,
        file: path.join(r.path, '.mcp.json'),
      })),
    ]

    const found: Discovered[] = []
    const push = (entries: Omit<Discovered, 'alreadyAdded'>[]) => {
      for (const entry of entries) {
        if (found.some((f) => f.name === entry.name)) continue
        found.push({ ...entry, alreadyAdded: existing.has(entry.name) })
      }
    }

    for (const s of sources) push(parseServers(s.label, await readJson(s.file)))

    // ~/.claude.json trzyma też definicje per projekt — tam siedzi większość serwerów.
    const claudeJson = (await readJson(path.join(os.homedir(), '.claude.json'))) as
      | { projects?: Record<string, unknown> }
      | undefined
    for (const [projectPath, cfg] of Object.entries(claudeJson?.projects ?? {})) {
      push(parseServers(`~/.claude.json → ${path.basename(projectPath)}`, cfg))
    }

    return { items: found }
  })
}

/** Zapisuje wskazane definicje jako wpisy panelu. */
export async function POST(req: Request) {
  return handle(req, async () => {
    const body = (await req.json()) as { servers?: Omit<Discovered, 'alreadyAdded'>[] }
    const servers = body.servers ?? []
    if (!servers.length) throw new Error('Nie wskazano serwerów do importu')

    const added: string[] = []
    await mutateStore((data) => {
      for (const s of servers) {
        if (data.mcpServers.some((m) => m.name === s.name)) continue
        const entry: McpEntry = {
          id: newId(),
          name: s.name,
          transport: s.transport,
          command: s.command,
          args: s.args ?? [],
          env: s.env ?? {},
          url: s.url,
          headers: s.headers ?? {},
          enabled: true,
          createdAt: Date.now(),
        }
        data.mcpServers.push(entry)
        added.push(entry.name)
      }
    })
    return { added }
  })
}
