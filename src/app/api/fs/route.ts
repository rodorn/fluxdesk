import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { handle } from '@/lib/api'
import { allowedRoots, isCwdAllowed } from '@/lib/config'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Prosta przeglądarka katalogów do wyboru `cwd` dla nowej sesji. */
export async function GET(req: Request) {
  return handle(req, async () => {
    const url = new URL(req.url)
    const requested = url.searchParams.get('path') || allowedRoots()[0] || os.homedir()
    const dir = path.resolve(requested)
    if (!isCwdAllowed(dir)) throw new Error('Katalog poza dozwolonym obszarem')

    const entries = await fsp.readdir(dir, { withFileTypes: true })
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => ({ name: e.name, path: path.join(dir, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name))

    const parent = path.dirname(dir)
    return {
      path: dir,
      parent: parent !== dir && isCwdAllowed(parent) ? parent : null,
      dirs,
      hasGit: entries.some((e) => e.name === '.git'),
      hasClaudeMd: entries.some((e) => e.name === 'CLAUDE.md'),
    }
  })
}
