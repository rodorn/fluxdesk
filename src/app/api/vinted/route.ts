import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { handle } from '@/lib/api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Stan scrapera Vinted. Baza bywa na innej maszynie, więc czytamy tylko to,
 * co leży lokalnie: log i plik bazy. Bez nich mówimy wprost, że nie wiadomo.
 */
export async function GET(req: Request) {
  return handle(req, async () => {
    const root = path.join(os.homedir(), 'PycharmProjects', 'Vinted_Scraper')

    const stat = async (p: string) => {
      try {
        const st = await fs.stat(p)
        return { exists: true, size: st.size, modified: st.mtimeMs }
      } catch {
        return { exists: false }
      }
    }

    const [db, log] = await Promise.all([
      stat(path.join(root, 'vinted.db')),
      stat(path.join(root, 'scraper.log')),
    ])

    let tail: string[] = []
    if (log.exists) {
      try {
        const text = await fs.readFile(path.join(root, 'scraper.log'), 'utf8')
        tail = text.trimEnd().split('\n').slice(-8)
      } catch {
        tail = []
      }
    }

    return {
      root,
      db,
      log,
      tail,
      // Log starszy niż dwie doby zwykle znaczy, że scraper stoi.
      stale: log.exists ? Date.now() - (log.modified ?? 0) > 2 * 86_400_000 : undefined,
    }
  })
}
