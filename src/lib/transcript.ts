import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

import { projectsDir } from './config'
import { estimateCost } from './pricing'
import {
  emptyUsage,
  type ContentBlock,
  type GlobalStats,
  type ProjectSummary,
  type SessionDetail,
  type TokenUsage,
  type TranscriptEntry,
} from './types'

/* ------------------------------------------------------------------ */
/* Odnajdywanie plików transkryptów                                     */
/* ------------------------------------------------------------------ */

export type TranscriptFile = {
  sessionId: string
  file: string
  projectDir: string
  mtimeMs: number
  size: number
}

/**
 * Skanuje ~/.claude/projects w poszukiwaniu plików <sessionId>.jsonl.
 * Katalogi projektów mają nazwy będące zakodowaną ścieżką (myślniki zamiast /),
 * ale prawdziwy `cwd` odczytujemy z zawartości pliku — to jedyne pewne źródło.
 */
export async function listTranscriptFiles(): Promise<TranscriptFile[]> {
  const root = projectsDir()
  let projectDirs: string[]
  try {
    projectDirs = (await fsp.readdir(root, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return []
  }

  const out: TranscriptFile[] = []
  await Promise.all(
    projectDirs.map(async (dirName) => {
      const dir = path.join(root, dirName)
      let entries: fs.Dirent[]
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (!e.isFile() || !e.name.endsWith('.jsonl')) continue
        const file = path.join(dir, e.name)
        try {
          const st = await fsp.stat(file)
          out.push({
            sessionId: e.name.replace(/\.jsonl$/, ''),
            file,
            projectDir: dirName,
            mtimeMs: st.mtimeMs,
            size: st.size,
          })
        } catch {
          /* plik zniknął w trakcie skanu — ignorujemy */
        }
      }
    })
  )
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

export async function findTranscriptFile(sessionId: string): Promise<TranscriptFile | undefined> {
  const all = await listTranscriptFiles()
  return all.find((f) => f.sessionId === sessionId)
}

/* ------------------------------------------------------------------ */
/* Parsowanie linia po linii                                            */
/* ------------------------------------------------------------------ */

type RawEntry = Record<string, unknown>

async function* readJsonl(file: string): AsyncGenerator<RawEntry> {
  const stream = fs.createReadStream(file, { encoding: 'utf8' })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        yield JSON.parse(trimmed) as RawEntry
      } catch {
        /* uszkodzona linia — pomijamy zamiast wywracać cały odczyt */
      }
    }
  } finally {
    rl.close()
    stream.destroy()
  }
}

function usageFrom(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const u = raw as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const usage: TokenUsage = {
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheCreate: num(u.cache_creation_input_tokens),
    cacheRead: num(u.cache_read_input_tokens),
  }
  if (!usage.input && !usage.output && !usage.cacheCreate && !usage.cacheRead) return undefined
  return usage
}

export function addUsage(target: TokenUsage, extra?: TokenUsage): TokenUsage {
  if (!extra) return target
  target.input += extra.input
  target.output += extra.output
  target.cacheCreate += extra.cacheCreate
  target.cacheRead += extra.cacheRead
  return target
}

export function totalTokens(u: TokenUsage): number {
  return u.input + u.output + u.cacheCreate + u.cacheRead
}

function normalizeBlocks(message: unknown): ContentBlock[] {
  if (!message || typeof message !== 'object') return []
  const content = (message as Record<string, unknown>).content
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (!Array.isArray(content)) return []
  return content.filter((b): b is ContentBlock => !!b && typeof b === 'object')
}

/** Pierwszy sensowny tekst użytkownika — używany jako tytuł zastępczy. */
function firstUserText(blocks: ContentBlock[]): string | undefined {
  for (const b of blocks) {
    if (b.type === 'text' && typeof (b as { text?: string }).text === 'string') {
      const t = (b as { text: string }).text.trim()
      // Pomijamy wstrzykiwane bloki systemowe typu <command-name> czy reminder.
      if (t && !t.startsWith('<')) return t
    }
  }
  return undefined
}

/* ------------------------------------------------------------------ */
/* Pełny transkrypt jednej sesji                                        */
/* ------------------------------------------------------------------ */

export async function readSessionDetail(
  sessionId: string,
  opts: { includeSidechains?: boolean } = {}
): Promise<SessionDetail | undefined> {
  const found = await findTranscriptFile(sessionId)
  if (!found) return undefined

  const entries: TranscriptEntry[] = []
  const usage = emptyUsage()
  const toolCounts: Record<string, number> = {}
  const models = new Set<string>()
  let cwd: string | undefined
  let gitBranch: string | undefined
  let createdAt: number | undefined
  let costUsd = 0
  // Claude Code zapisuje tę samą odpowiedź wielokrotnie (aktualizacje w trakcie
  // strumieniowania). Bez odsiania powtórek tokeny i koszt rosną ponad dwukrotnie.
  const countedRequests = new Set<string>()
  let customTitle: string | undefined
  let aiTitle: string | undefined
  let summaryTitle: string | undefined
  let fallbackTitle: string | undefined

  for await (const raw of readJsonl(found.file)) {
    const type = typeof raw.type === 'string' ? raw.type : ''

    // Wpisy meta zapisywane przez /rename i auto-summary.
    if (type === 'summary' && typeof raw.summary === 'string') {
      summaryTitle = raw.summary
      continue
    }
    // Nazwa nadana ręcznie ma pierwszeństwo nad wygenerowaną; obie bywają
    // powtarzane w pliku, więc zwycięża ostatnia.
    if (type === 'custom-title' && typeof raw.customTitle === 'string') {
      customTitle = raw.customTitle
      continue
    }
    if (type === 'ai-title' && typeof raw.aiTitle === 'string') {
      aiTitle = raw.aiTitle
      continue
    }
    if (type === 'title' && typeof raw.title === 'string') {
      customTitle = raw.title
      continue
    }

    if (typeof raw.cwd === 'string' && !cwd) cwd = raw.cwd
    if (typeof raw.gitBranch === 'string' && raw.gitBranch) gitBranch = raw.gitBranch
    if (typeof raw.timestamp === 'string' && createdAt === undefined) {
      const t = Date.parse(raw.timestamp)
      if (!Number.isNaN(t)) createdAt = t
    }

    if (type !== 'user' && type !== 'assistant' && type !== 'system') continue

    const isSidechain = raw.isSidechain === true
    if (isSidechain && !opts.includeSidechains) continue

    const message = raw.message
    const blocks = normalizeBlocks(message)
    const model =
      message && typeof message === 'object'
        ? ((message as Record<string, unknown>).model as string | undefined)
        : undefined
    if (model) models.add(model)

    const entryUsage =
      message && typeof message === 'object'
        ? usageFrom((message as Record<string, unknown>).usage)
        : undefined

    let entryCost: number | undefined
    if (typeof raw.costUSD === 'number') entryCost = raw.costUSD
    else if (entryUsage) entryCost = estimateCost(model, entryUsage)

    if (!isSidechain) {
      addUsage(usage, entryUsage)
      costUsd += entryCost ?? 0
      for (const b of blocks) {
        if (b.type === 'tool_use') {
          const name = (b as { name?: string }).name || 'unknown'
          toolCounts[name] = (toolCounts[name] || 0) + 1
        }
      }
      if (type === 'user' && !fallbackTitle) fallbackTitle = firstUserText(blocks)
    }

    entries.push({
      uuid: typeof raw.uuid === 'string' ? raw.uuid : `${entries.length}`,
      parentUuid: typeof raw.parentUuid === 'string' ? raw.parentUuid : null,
      role: type as 'user' | 'assistant' | 'system',
      timestamp: typeof raw.timestamp === 'string' ? raw.timestamp : undefined,
      model,
      isSidechain,
      isMeta: raw.isMeta === true,
      blocks,
      usage: entryUsage,
      costUsd: entryCost,
      systemSubtype: typeof raw.subtype === 'string' ? raw.subtype : undefined,
    })
  }

  const title = customTitle || summaryTitle || fallbackTitle?.slice(0, 120) || sessionId.slice(0, 8)

  return {
    sessionId,
    cwd,
    gitBranch,
    title,
    createdAt,
    lastModified: found.mtimeMs,
    models: [...models],
    usage,
    costUsd,
    entryCount: entries.length,
    toolCounts,
    entries,
  }
}

/* ------------------------------------------------------------------ */
/* Lekki skan wszystkich sesji + cache                                  */
/* ------------------------------------------------------------------ */

export type SessionScan = {
  sessionId: string
  cwd?: string
  gitBranch?: string
  title?: string
  createdAt?: number
  lastModified: number
  size: number
  messageCount: number
  usage: TokenUsage
  costUsd: number
  models: string[]
  toolCounts: Record<string, number>
}

type CacheEntry = { mtimeMs: number; size: number; scan: SessionScan }

/**
 * Cache skanów przeżywa restart panelu. Bez niego każde uruchomienie czytało
 * ponownie ponad gigabajt transkryptów, żeby policzyć dokładnie to samo.
 */
const cacheRef = globalThis as unknown as { __csmScanCache?: Map<string, CacheEntry> }
const scanCache: Map<string, CacheEntry> = (cacheRef.__csmScanCache ??= new Map())

function scanCachePath(): string {
  return path.join(
    process.env.CSM_DATA_DIR || path.join(os.homedir(), '.claude-session-manager'),
    'scan-cache.json'
  )
}

let cacheLoaded = false
let cacheDirty = false

async function loadScanCache(): Promise<void> {
  if (cacheLoaded) return
  cacheLoaded = true
  try {
    const raw = JSON.parse(await fsp.readFile(scanCachePath(), 'utf8')) as {
      version: number
      entries: [string, CacheEntry][]
    }
    // Wersja rośnie, gdy zmienia się sposób liczenia — stare wpisy trzeba odrzucić.
    if (raw.version !== SCAN_CACHE_VERSION) return
    for (const [file, entry] of raw.entries) scanCache.set(file, entry)
  } catch {
    /* brak cache albo uszkodzony — policzymy od nowa */
  }
}

async function saveScanCache(): Promise<void> {
  if (!cacheDirty) return
  cacheDirty = false
  try {
    const file = scanCachePath()
    await fsp.mkdir(path.dirname(file), { recursive: true })
    await fsp.writeFile(
      file,
      JSON.stringify({ version: SCAN_CACHE_VERSION, entries: [...scanCache.entries()] })
    )
  } catch {
    /* brak prawa zapisu nie może wywrócić odczytu statystyk */
  }
}

/** Podnieś przy każdej zmianie sposobu liczenia zużycia albo tytułów. */
const SCAN_CACHE_VERSION = 2

async function scanFile(f: TranscriptFile): Promise<SessionScan> {
  const cached = scanCache.get(f.file)
  if (cached && cached.mtimeMs === f.mtimeMs && cached.size === f.size) return cached.scan

  const usage = emptyUsage()
  const toolCounts: Record<string, number> = {}
  const models = new Set<string>()
  let cwd: string | undefined
  let gitBranch: string | undefined
  let createdAt: number | undefined
  let costUsd = 0
  let messageCount = 0
  // Claude Code zapisuje tę samą odpowiedź wielokrotnie (aktualizacje w trakcie
  // strumieniowania). Bez odsiania powtórek tokeny i koszt rosną ponad dwukrotnie.
  const countedRequests = new Set<string>()
  let customTitle: string | undefined
  let aiTitle: string | undefined
  let summaryTitle: string | undefined
  let fallbackTitle: string | undefined

  for await (const raw of readJsonl(f.file)) {
    const type = typeof raw.type === 'string' ? raw.type : ''
    if (type === 'summary' && typeof raw.summary === 'string') {
      summaryTitle = raw.summary
      continue
    }
    // Nazwa nadana ręcznie ma pierwszeństwo nad wygenerowaną; obie bywają
    // powtarzane w pliku, więc zwycięża ostatnia.
    if (type === 'custom-title' && typeof raw.customTitle === 'string') {
      customTitle = raw.customTitle
      continue
    }
    if (type === 'ai-title' && typeof raw.aiTitle === 'string') {
      aiTitle = raw.aiTitle
      continue
    }
    if (type === 'title' && typeof raw.title === 'string') {
      customTitle = raw.title
      continue
    }
    if (typeof raw.cwd === 'string' && !cwd) cwd = raw.cwd
    if (typeof raw.gitBranch === 'string' && raw.gitBranch) gitBranch = raw.gitBranch
    if (createdAt === undefined && typeof raw.timestamp === 'string') {
      const t = Date.parse(raw.timestamp)
      if (!Number.isNaN(t)) createdAt = t
    }
    if (raw.isSidechain === true) continue
    if (type !== 'user' && type !== 'assistant') continue

    const message = raw.message as Record<string, unknown> | undefined
    const model = message?.model as string | undefined

    const requestKey =
      typeof raw.requestId === 'string' ? raw.requestId : (raw.uuid as string | undefined)
    if (type === 'assistant' && requestKey) {
      if (countedRequests.has(requestKey)) continue
      countedRequests.add(requestKey)
    }

    messageCount++
    if (model) models.add(model)
    const u = usageFrom(message?.usage)
    addUsage(usage, u)
    if (typeof raw.costUSD === 'number') costUsd += raw.costUSD
    else if (u) costUsd += estimateCost(model, u)

    if (type === 'assistant') {
      for (const b of normalizeBlocks(message)) {
        if (b.type === 'tool_use') {
          const name = (b as { name?: string }).name || 'unknown'
          toolCounts[name] = (toolCounts[name] || 0) + 1
        }
      }
    } else if (!fallbackTitle) {
      fallbackTitle = firstUserText(normalizeBlocks(message))
    }
  }

  const scan: SessionScan = {
    sessionId: f.sessionId,
    cwd,
    gitBranch,
    title: customTitle || aiTitle || summaryTitle || fallbackTitle?.slice(0, 120),
    createdAt,
    lastModified: f.mtimeMs,
    size: f.size,
    messageCount,
    usage,
    costUsd,
    models: [...models],
    toolCounts,
  }
  scanCache.set(f.file, { mtimeMs: f.mtimeMs, size: f.size, scan })
  cacheDirty = true
  return scan
}

/** Skanuje wszystkie sesje (z cache po mtime — kolejne wywołania są tanie). */
export async function scanAllSessions(): Promise<SessionScan[]> {
  await loadScanCache()
  const files = await listTranscriptFiles()
  const out: SessionScan[] = []
  // Ograniczamy równoległość, żeby nie wyczerpać deskryptorów plików.
  const CONCURRENCY = 12
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const chunk = files.slice(i, i + CONCURRENCY)
    out.push(...(await Promise.all(chunk.map(scanFile))))
  }
  await saveScanCache()
  return out
}

export async function computeStats(): Promise<GlobalStats> {
  const scans = await scanAllSessions()
  const usage = emptyUsage()
  const toolCounts: Record<string, number> = {}
  const modelCounts: Record<string, number> = {}
  const byDay = new Map<string, { sessions: number; costUsd: number }>()
  const byProject = new Map<string, ProjectSummary>()
  let totalCostUsd = 0

  for (const s of scans) {
    addUsage(usage, s.usage)
    totalCostUsd += s.costUsd
    for (const [k, v] of Object.entries(s.toolCounts)) toolCounts[k] = (toolCounts[k] || 0) + v
    for (const m of s.models) modelCounts[m] = (modelCounts[m] || 0) + 1

    const day = new Date(s.createdAt ?? s.lastModified).toISOString().slice(0, 10)
    const d = byDay.get(day) ?? { sessions: 0, costUsd: 0 }
    d.sessions++
    d.costUsd += s.costUsd
    byDay.set(day, d)

    const cwd = s.cwd || '(nieznany katalog)'
    const p = byProject.get(cwd) ?? {
      cwd,
      name: cwd.split('/').filter(Boolean).pop() || cwd,
      sessionCount: 0,
      lastActivity: 0,
      totalCostUsd: 0,
      totalTokens: 0,
    }
    p.sessionCount++
    p.lastActivity = Math.max(p.lastActivity, s.lastModified)
    p.totalCostUsd += s.costUsd
    p.totalTokens += totalTokens(s.usage)
    byProject.set(cwd, p)
  }

  const daily = [...byDay.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-90)

  return {
    sessionCount: scans.length,
    projectCount: byProject.size,
    totalCostUsd,
    usage,
    toolCounts,
    modelCounts,
    daily,
    projects: [...byProject.values()].sort((a, b) => b.lastActivity - a.lastActivity),
  }
}
