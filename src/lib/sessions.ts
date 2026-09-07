import { scanAllSessions, totalTokens, type SessionScan } from './transcript'
import type { SessionSummary } from './types'

/**
 * Agent SDK ładujemy dynamicznie — pakiet jest CJS-owy i uruchamia podprocess CLI,
 * więc nie chcemy go wciągać do bundla przy każdym imporcie modułu.
 */
async function sdk() {
  return await import('@anthropic-ai/claude-agent-sdk')
}

export type SessionListItem = SessionSummary & {
  messageCount: number
  totalTokens: number
  costUsd: number
  models: string[]
}

export type SessionFilter = {
  cwd?: string
  q?: string
  sort?: 'recent' | 'oldest' | 'cost' | 'tokens' | 'messages'
  limit?: number
  offset?: number
}

/**
 * Lista sesji. Metadane (tytuł, tag, gałąź) bierzemy z SDK, a statystyki
 * (tokeny, koszt, liczba wiadomości) z własnego skanu transkryptów.
 * Jeśli SDK zawiedzie (starsza wersja CLI), działamy wyłącznie na skanie.
 */
export async function listSessions(filter: SessionFilter = {}): Promise<{
  items: SessionListItem[]
  total: number
}> {
  const scans = await scanAllSessions()
  const byId = new Map<string, SessionScan>(scans.map((s) => [s.sessionId, s]))

  let meta: Awaited<ReturnType<Awaited<ReturnType<typeof sdk>>['listSessions']>> = []
  try {
    const { listSessions: sdkList } = await sdk()
    meta = await sdkList({ includeProgrammatic: true })
  } catch {
    meta = []
  }
  const metaById = new Map(meta.map((m) => [m.sessionId, m]))

  let items: SessionListItem[] = scans.map((s) => {
    const m = metaById.get(s.sessionId)
    return {
      sessionId: s.sessionId,
      summary: m?.summary || s.title || s.sessionId.slice(0, 8),
      lastModified: s.lastModified,
      createdAt: s.createdAt ?? m?.createdAt,
      fileSize: s.size,
      customTitle: m?.customTitle,
      firstPrompt: m?.firstPrompt || s.title,
      gitBranch: s.gitBranch ?? m?.gitBranch,
      cwd: s.cwd ?? m?.cwd,
      tag: m?.tag,
      messageCount: s.messageCount,
      totalTokens: totalTokens(s.usage),
      costUsd: s.costUsd,
      models: s.models,
    }
  })

  if (filter.cwd) items = items.filter((i) => i.cwd === filter.cwd)

  if (filter.q) {
    const q = filter.q.toLowerCase()
    items = items.filter((i) =>
      [i.summary, i.firstPrompt, i.cwd, i.gitBranch, i.tag, i.sessionId]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    )
  }

  const sort = filter.sort ?? 'recent'
  items.sort((a, b) => {
    switch (sort) {
      case 'oldest':
        return (a.createdAt ?? a.lastModified) - (b.createdAt ?? b.lastModified)
      case 'cost':
        return b.costUsd - a.costUsd
      case 'tokens':
        return b.totalTokens - a.totalTokens
      case 'messages':
        return b.messageCount - a.messageCount
      default:
        return b.lastModified - a.lastModified
    }
  })

  const total = items.length
  const offset = filter.offset ?? 0
  const limit = filter.limit ?? 50
  return { items: items.slice(offset, offset + limit), total }
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
  const { renameSession: fn } = await sdk()
  await fn(sessionId, title)
}

export async function tagSession(sessionId: string, tag: string | null): Promise<void> {
  const { tagSession: fn } = await sdk()
  await fn(sessionId, tag)
}

export async function deleteSession(sessionId: string): Promise<void> {
  const { deleteSession: fn } = await sdk()
  await fn(sessionId)
}

export async function forkSession(
  sessionId: string,
  opts: { upToMessageId?: string; title?: string } = {}
): Promise<{ sessionId: string }> {
  const { forkSession: fn } = await sdk()
  return await fn(sessionId, opts)
}
