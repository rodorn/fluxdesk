import path from 'node:path'

import { handle } from '@/lib/api'
import { isCwdAllowed } from '@/lib/config'
import { cachedRepoInfo, repoInfo, warmRepoInfo } from '@/lib/git'
import { mutateStore, newId, readStore, type RepoEntry } from '@/lib/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  return handle(req, async () => {
    const { repos } = await readStore()
    // Lista wraca od razu z tym, co jest w cache; brakujące dane dociągamy w tle.
    const items = repos.map((r) => ({ ...r, info: cachedRepoInfo(r.path) }))
    if (items.some((i) => !i.info)) {
      void warmRepoInfo(repos.map((r) => r.path))
    }
    return { items }
  })
}

export async function POST(req: Request) {
  return handle(req, async () => {
    const body = (await req.json()) as { path?: string; name?: string; tags?: string[] }
    if (!body.path) throw new Error('Brak ścieżki repozytorium')

    const dir = path.resolve(body.path)
    if (!isCwdAllowed(dir)) throw new Error('Katalog poza dozwolonym obszarem (CSM_ALLOWED_ROOTS)')

    const info = await repoInfo(dir)
    if (!info.exists) throw new Error(info.error || 'Katalog nie istnieje')

    const entry: RepoEntry = {
      id: newId(),
      name: body.name?.trim() || path.basename(dir),
      path: dir,
      tags: body.tags ?? [],
      createdAt: Date.now(),
    }

    await mutateStore((data) => {
      if (data.repos.some((r) => r.path === dir)) {
        throw new Error('To repozytorium jest już dodane')
      }
      data.repos.push(entry)
    })

    return { ...entry, info }
  })
}
