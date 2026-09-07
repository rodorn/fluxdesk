import { execFile } from 'node:child_process'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export type RepoInfo = {
  exists: boolean
  isGit: boolean
  branch?: string
  remote?: string
  /** Liczba zmienionych plików (git status --porcelain). */
  dirtyFiles?: number
  lastCommit?: { hash: string; subject: string; date: string }
  hasClaudeMd: boolean
  hasMcpConfig: boolean
  error?: string
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', ['-C', cwd, ...args], {
    timeout: 4000,
    maxBuffer: 1024 * 1024,
  })
  return stdout.trim()
}

/** Wywołania gita kosztują po kilkadziesiąt ms na repozytorium, a lista bywa długa. */
const INFO_TTL_MS = 30_000
type InfoCache = Map<string, { at: number; info: RepoInfo }>
const infoRef = globalThis as unknown as { __csmRepoInfo?: InfoCache }
const infoCache: InfoCache = (infoRef.__csmRepoInfo ??= new Map())

/**
 * Zbiera podstawowe informacje o katalogu repozytorium.
 * Każdy krok jest odporny na brak gita / brak repo — zwracamy to, co się udało.
 */
export async function repoInfo(dir: string): Promise<RepoInfo> {
  const cached = infoCache.get(dir)
  if (cached && Date.now() - cached.at < INFO_TTL_MS) return cached.info
  const fresh = await computeRepoInfo(dir)
  infoCache.set(dir, { at: Date.now(), info: fresh })
  return fresh
}

/**
 * Wersja dla list: nigdy nie czeka na gita. Brakujące dane dociągane są w tle,
 * więc pierwsze wejście na pulpit nie płaci za kilkadziesiąt wywołań `git`.
 */
export function cachedRepoInfo(dir: string): RepoInfo | undefined {
  const cached = infoCache.get(dir)
  if (cached && Date.now() - cached.at >= INFO_TTL_MS) void repoInfo(dir).catch(() => undefined)
  return cached?.info
}

/** Uzupełnia cache dla podanych katalogów, po kilka naraz. */
export async function warmRepoInfo(dirs: string[]): Promise<void> {
  const CONCURRENCY = 6
  for (let i = 0; i < dirs.length; i += CONCURRENCY) {
    await Promise.all(
      dirs.slice(i, i + CONCURRENCY).map((d) => repoInfo(d).catch(() => undefined))
    )
  }
}

async function computeRepoInfo(dir: string): Promise<RepoInfo> {
  const info: RepoInfo = { exists: false, isGit: false, hasClaudeMd: false, hasMcpConfig: false }

  try {
    const st = await fsp.stat(dir)
    if (!st.isDirectory()) {
      info.error = 'Ścieżka nie jest katalogiem'
      return info
    }
    info.exists = true
  } catch {
    info.error = 'Katalog nie istnieje'
    return info
  }

  const [claudeMd, mcpJson] = await Promise.all([
    fsp
      .access(path.join(dir, 'CLAUDE.md'))
      .then(() => true)
      .catch(() => false),
    fsp
      .access(path.join(dir, '.mcp.json'))
      .then(() => true)
      .catch(() => false),
  ])
  info.hasClaudeMd = claudeMd
  info.hasMcpConfig = mcpJson

  try {
    await git(dir, ['rev-parse', '--is-inside-work-tree'])
    info.isGit = true
  } catch {
    return info
  }

  await Promise.all([
    git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])
      .then((b) => (info.branch = b))
      .catch(() => undefined),
    git(dir, ['remote', 'get-url', 'origin'])
      .then((r) => (info.remote = r))
      .catch(() => undefined),
    git(dir, ['status', '--porcelain'])
      .then((s) => (info.dirtyFiles = s ? s.split('\n').length : 0))
      .catch(() => undefined),
    git(dir, ['log', '-1', '--format=%h%x1f%s%x1f%cI'])
      .then((l) => {
        const [hash, subject, date] = l.split('\x1f')
        if (hash) info.lastCommit = { hash, subject: subject ?? '', date: date ?? '' }
      })
      .catch(() => undefined),
  ])

  return info
}
