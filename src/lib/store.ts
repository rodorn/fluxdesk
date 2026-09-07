import { randomUUID } from 'node:crypto'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/* ------------------------------------------------------------------ */
/* Model danych                                                        */
/* ------------------------------------------------------------------ */

export type RepoEntry = {
  id: string
  /** Nazwa wyświetlana; domyślnie nazwa katalogu. */
  name: string
  /** Ścieżka bezwzględna do katalogu repozytorium. */
  path: string
  /** Dowolne etykiety do grupowania (np. "backend", "klient-x"). */
  tags: string[]
  createdAt: number
}

export type McpTransport = 'stdio' | 'http' | 'sse'

export type McpEntry = {
  id: string
  /** Nazwa, pod którą serwer widoczny jest dla Claude (prefiks narzędzi mcp__<name>__*). */
  name: string
  transport: McpTransport
  /** stdio */
  command?: string
  args?: string[]
  env?: Record<string, string>
  /** http / sse */
  url?: string
  headers?: Record<string, string>
  /** Czy serwer jest dostępny do wpięcia w przestrzenie. */
  enabled: boolean
  createdAt: number
}

export type WorkspaceEntry = {
  id: string
  name: string
  /** Repozytorium główne — trafia do `cwd` sesji. */
  primaryRepoId: string
  /** Dodatkowe repozytoria — trafiają do `additionalDirectories`. */
  extraRepoIds: string[]
  /** Serwery MCP wpięte do tej przestrzeni. */
  mcpIds: string[]
  model?: string
  permissionMode?: string
  /** Narzędzia auto-zatwierdzane bez pytania (np. "Read", "mcp__linear"). */
  allowedTools: string[]
  createdAt: number
}

export type StoreData = {
  version: 1
  repos: RepoEntry[]
  mcpServers: McpEntry[]
  workspaces: WorkspaceEntry[]
}

const EMPTY: StoreData = { version: 1, repos: [], mcpServers: [], workspaces: [] }

/* ------------------------------------------------------------------ */
/* Odczyt/zapis                                                        */
/* ------------------------------------------------------------------ */

export function dataDir(): string {
  return process.env.CSM_DATA_DIR || path.join(os.homedir(), '.claude-session-manager')
}

function configFile(): string {
  return path.join(dataDir(), 'config.json')
}

let writeChain: Promise<unknown> = Promise.resolve()

export async function readStore(): Promise<StoreData> {
  try {
    const raw = await fsp.readFile(configFile(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<StoreData>
    return {
      version: 1,
      repos: parsed.repos ?? [],
      mcpServers: parsed.mcpServers ?? [],
      workspaces: parsed.workspaces ?? [],
    }
  } catch {
    return { ...EMPTY }
  }
}

/**
 * Modyfikacja pod wspólną kolejką zapisu — API routes bywają wywoływane
 * równolegle, a zapis read-modify-write bez serializacji gubiłby zmiany.
 * Zapis jest atomowy (tmp + rename).
 */
export async function mutateStore<T>(fn: (data: StoreData) => T | Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const data = await readStore()
    const result = await fn(data)
    const file = configFile()
    await fsp.mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
    await fsp.rename(tmp, file)
    return result
  }
  const next = writeChain.then(run, run)
  writeChain = next.catch(() => undefined)
  return next
}

export const newId = () => randomUUID()

/* ------------------------------------------------------------------ */
/* Rozwiązywanie przestrzeni roboczej do parametrów sesji              */
/* ------------------------------------------------------------------ */

export type ResolvedWorkspace = {
  workspace: WorkspaceEntry
  primary: RepoEntry
  extras: RepoEntry[]
  mcp: McpEntry[]
}

export async function resolveWorkspace(id: string): Promise<ResolvedWorkspace> {
  const data = await readStore()
  const workspace = data.workspaces.find((w) => w.id === id)
  if (!workspace) throw new Error('Nie znaleziono przestrzeni roboczej')

  const primary = data.repos.find((r) => r.id === workspace.primaryRepoId)
  if (!primary) throw new Error('Przestrzeń wskazuje na nieistniejące repozytorium główne')

  const extras = workspace.extraRepoIds
    .map((rid) => data.repos.find((r) => r.id === rid))
    .filter((r): r is RepoEntry => !!r)

  const mcp = workspace.mcpIds
    .map((mid) => data.mcpServers.find((m) => m.id === mid))
    .filter((m): m is McpEntry => !!m && m.enabled)

  return { workspace, primary, extras, mcp }
}

/** Zamienia wpisy MCP na mapę konfiguracji akceptowaną przez Agent SDK. */
export function toMcpServerConfig(entries: McpEntry[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const m of entries) {
    if (m.transport === 'stdio') {
      if (!m.command) continue
      out[m.name] = {
        type: 'stdio',
        command: m.command,
        args: m.args ?? [],
        ...(m.env && Object.keys(m.env).length ? { env: m.env } : {}),
      }
    } else {
      if (!m.url) continue
      out[m.name] = {
        type: m.transport,
        url: m.url,
        ...(m.headers && Object.keys(m.headers).length ? { headers: m.headers } : {}),
      }
    }
  }
  return out
}
