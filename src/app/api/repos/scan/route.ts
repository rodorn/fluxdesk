import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { randomUUID } from 'node:crypto'

import { handle } from '@/lib/api'
import { mutateStore, type RepoEntry } from '@/lib/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Katalogi, w których zwykle mieszkają projekty. */
function defaultRoots(): string[] {
  const home = os.homedir()
  return [
    path.join(home, 'PycharmProjects'),
    path.join(home, 'WebstormProjects'),
    path.join(home, 'Projekty'),
    home,
  ]
}

async function isRepo(dir: string): Promise<boolean> {
  try {
    const st = await fsp.stat(path.join(dir, '.git'))
    return st.isDirectory() || st.isFile()
  } catch {
    return false
  }
}

/** Szuka repozytoriów na jednym poziomie pod każdym z korzeni (plus sam korzeń). */
async function findRepos(roots: string[]): Promise<string[]> {
  const found = new Set<string>()
  for (const root of roots) {
    if (await isRepo(root)) found.add(root)
    let entries
    try {
      entries = await fsp.readdir(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      const dir = path.join(root, e.name)
      if (await isRepo(dir)) found.add(dir)
    }
  }
  return [...found].sort()
}

export async function POST(req: Request) {
  return handle(req, async () => {
    const body = (await req.json().catch(() => ({}))) as { roots?: string[] }
    const roots = body.roots?.length ? body.roots.map((r) => path.resolve(r)) : defaultRoots()
    const dirs = await findRepos(roots)

    return mutateStore((data) => {
      const known = new Set(data.repos.map((r) => path.resolve(r.path)))
      const added: RepoEntry[] = []
      for (const dir of dirs) {
        if (known.has(dir)) continue
        const entry: RepoEntry = {
          id: randomUUID(),
          name: path.basename(dir),
          path: dir,
          tags: [],
          createdAt: Date.now(),
        }
        data.repos.push(entry)
        added.push(entry)
      }
      return { scanned: dirs.length, added: added.length, total: data.repos.length, roots }
    })
  })
}
