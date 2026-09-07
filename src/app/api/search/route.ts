import fs from 'node:fs/promises'

import { handle } from '@/lib/api'
import { lightScanAll } from '@/lib/lightscan'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export type Hit = {
  sessionId: string
  title?: string
  cwd?: string
  at?: number
  /** Fragment wypowiedzi z podświetlonym trafieniem po stronie klienta. */
  excerpt: string
  role: 'user' | 'assistant'
}

const MAX_HITS = 60
const CHUNK = 4 * 1024 * 1024

/** Wypowiedź jako zwykły tekst, bez bloków narzędzi i obrazów. */
function messageText(raw: Record<string, unknown>): string {
  const message = raw.message as { content?: unknown } | undefined
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((b) => {
      const block = b as { type?: string; text?: string }
      return block?.type === 'text' ? (block.text ?? '') : ''
    })
    .join(' ')
}

/**
 * Przeszukiwanie transkryptów. Plików jest ponad gigabajt, więc czytamy je
 * strumieniowo i przerywamy, gdy trafień wystarczy na odpowiedź.
 */
async function searchFile(
  file: string,
  needle: string,
  hits: Hit[],
  meta: { sessionId: string; title?: string; cwd?: string }
): Promise<void> {
  let handle_: Awaited<ReturnType<typeof fs.open>> | undefined
  try {
    handle_ = await fs.open(file, 'r')
    const stat = await handle_.stat()
    let position = Math.max(0, stat.size - CHUNK)
    // Zaczynamy od końca: świeższe rozmowy są zwykle tym, czego szukasz.
    const buffer = Buffer.alloc(Math.min(CHUNK, stat.size))
    await handle_.read(buffer, 0, buffer.length, position)

    for (const line of buffer.toString('utf8').split('\n')) {
      if (hits.length >= MAX_HITS) return
      if (!line.trim().startsWith('{') || !line.trim().endsWith('}')) continue
      if (!line.toLowerCase().includes(needle)) continue

      let raw: Record<string, unknown>
      try {
        raw = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue
      }
      const role = raw.type
      if (role !== 'user' && role !== 'assistant') continue

      const text = messageText(raw)
      const at = text.toLowerCase().indexOf(needle)
      if (at === -1) continue

      hits.push({
        sessionId: meta.sessionId,
        title: meta.title,
        cwd: meta.cwd,
        at: typeof raw.timestamp === 'string' ? Date.parse(raw.timestamp) : undefined,
        excerpt: text.slice(Math.max(0, at - 90), at + 160).replace(/\s+/g, ' ').trim(),
        role,
      })
    }
    void position
  } catch {
    /* plik zniknął albo jest nieczytelny */
  } finally {
    await handle_?.close()
  }
}

export async function GET(req: Request) {
  return handle(req, async () => {
    const q = (new URL(req.url).searchParams.get('q') ?? '').trim().toLowerCase()
    if (q.length < 3) return { items: [], note: 'Podaj co najmniej trzy znaki' }

    const scans = (await lightScanAll()).sort(
      (a, b) => (b.lastMessageAt ?? b.lastModified) - (a.lastMessageAt ?? a.lastModified)
    )

    const hits: Hit[] = []
    for (const scan of scans) {
      if (hits.length >= MAX_HITS) break
      await searchFile(scan.file, q, hits, {
        sessionId: scan.sessionId,
        title: scan.title,
        cwd: scan.cwd,
      })
    }

    return { items: hits.sort((a, b) => (b.at ?? 0) - (a.at ?? 0)) }
  })
}
