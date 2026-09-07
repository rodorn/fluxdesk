import fsp from 'node:fs/promises'
import path from 'node:path'

import { handle } from '@/lib/api'
import { isCwdAllowed } from '@/lib/config'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', '__pycache__', 'venv'])
const MAX_RESULTS = 40
const MAX_VISITED = 8000

/**
 * Szukanie plików do podpowiedzi po znaku małpy. Chodzimy wszerz i przerywamy
 * po kilku tysiącach wpisów, bo to ma odpowiadać w trakcie pisania.
 */
async function search(root: string, needle: string): Promise<string[]> {
  const hits: string[] = []
  const queue: string[] = [root]
  let visited = 0
  const lower = needle.toLowerCase()

  while (queue.length && hits.length < MAX_RESULTS && visited < MAX_VISITED) {
    const dir = queue.shift()!
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      visited++
      if (e.name.startsWith('.') || SKIP.has(e.name)) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        queue.push(full)
      } else if (!lower || e.name.toLowerCase().includes(lower)) {
        hits.push(path.relative(root, full))
        if (hits.length >= MAX_RESULTS) break
      }
    }
  }

  // Krótsze ścieżki zwykle są tym, czego szukasz.
  return hits.sort((a, b) => a.length - b.length)
}

export async function GET(req: Request) {
  return handle(req, async () => {
    const params = new URL(req.url).searchParams
    const cwd = params.get('cwd')
    if (!cwd) throw new Error('Podaj katalog')
    const dir = path.resolve(cwd)
    if (!isCwdAllowed(dir)) throw new Error('Katalog poza dozwolonym obszarem')
    return { items: await search(dir, params.get('q') ?? '') }
  })
}
