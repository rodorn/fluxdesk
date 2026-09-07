import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { handle } from '@/lib/api'
import { repoInfo } from '@/lib/git'
import { readStore } from '@/lib/store'

const run = promisify(execFile)

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

type Cache = { at: number; data: unknown }
const ref = globalThis as unknown as { __csmPulse?: Cache }
const TTL_MS = 60_000

/** Jednostki systemd użytkownika: co ma działać, a co się wysypało. */
async function services() {
  try {
    const { stdout } = await run(
      'systemctl',
      ['--user', 'list-units', '--type=service', '--type=timer', '--all', '--output=json'],
      { timeout: 8000, maxBuffer: 4 * 1024 * 1024 }
    )
    const units = JSON.parse(stdout) as { unit: string; active: string; sub: string }[]
    return units
      .filter((u) => !u.unit.startsWith('dbus-') && !u.unit.includes('@'))
      .filter((u) => u.active === 'failed' || u.unit.includes('fluxdesk') || u.sub === 'running')
      .map((u) => ({ name: u.unit, active: u.active, sub: u.sub }))
      .slice(0, 40)
  } catch {
    return []
  }
}

/** Repozytoria z niezacommitowanymi zmianami, czyli robota w toku. */
async function repos() {
  const store = await readStore()
  const out = []
  for (const repo of store.repos.slice(0, 40)) {
    const info = await repoInfo(repo.path)
    if (!info.isGit) continue
    if (!info.dirtyFiles) continue
    out.push({
      name: repo.name,
      path: repo.path,
      branch: info.branch,
      dirtyFiles: info.dirtyFiles,
      lastCommit: info.lastCommit?.subject,
    })
  }
  return out.sort((a, b) => (b.dirtyFiles ?? 0) - (a.dirtyFiles ?? 0))
}

/**
 * Puls maszyny: usługi, które padły, i repozytoria z niedokończoną robotą.
 * To rzeczy, o których dowiadujesz się zwykle wtedy, gdy jest już za późno.
 */
export async function GET(req: Request) {
  return handle(req, async () => {
    const cached = ref.__csmPulse
    if (cached && Date.now() - cached.at < TTL_MS) return cached.data

    const [units, dirty] = await Promise.all([services(), repos()])
    const data = {
      failed: units.filter((u) => u.active === 'failed'),
      running: units.filter((u) => u.active !== 'failed').length,
      dirtyRepos: dirty,
    }
    ref.__csmPulse = { at: Date.now(), data }
    return data
  })
}
