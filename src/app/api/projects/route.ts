import path from 'node:path'

import { handle } from '@/lib/api'
import { repoInfo } from '@/lib/git'
import { lightScanAll } from '@/lib/lightscan'
import { readStore } from '@/lib/store'
import { listTasks } from '@/lib/todo'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * Karta projektu: wszystko, co panel o nim wie, w jednym miejscu. Wcześniej ta
 * wiedza leżała rozsypana po sesjach, zadaniach i repozytoriach.
 */
export async function GET(req: Request) {
  return handle(req, async () => {
    const [store, scans, tasks] = await Promise.all([
      readStore(),
      lightScanAll(),
      listTasks({ group: 'all' }),
    ])

    const items = await Promise.all(
      store.repos.map(async (repo) => {
        const name = path.basename(repo.path)
        const sessions = scans.filter((s) => s.cwd === repo.path)
        const related = tasks.filter((t) => t.project === name || t.tags.includes(name))
        const info = await repoInfo(repo.path)

        return {
          name,
          path: repo.path,
          branch: info.branch,
          dirtyFiles: info.dirtyFiles ?? 0,
          lastCommit: info.lastCommit?.subject,
          hasClaudeMd: info.hasClaudeMd,
          sessions: sessions.length,
          lastSession: Math.max(0, ...sessions.map((s) => s.lastMessageAt ?? s.lastModified)),
          openTasks: related.filter((t) => t.status !== 'zrobione').length,
          doneTasks: related.filter((t) => t.status === 'zrobione').length,
        }
      })
    )

    return {
      items: items
        .filter((p) => p.sessions > 0 || p.openTasks > 0 || p.dirtyFiles > 0)
        .sort((a, b) => b.lastSession - a.lastSession),
    }
  })
}
