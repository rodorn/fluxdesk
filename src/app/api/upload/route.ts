import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { handle } from '@/lib/api'
import { dataDir } from '@/lib/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/**
 * Zrzut ekranu wklejony do terminala. Pty nie przyjmie obrazu, więc zapisujemy
 * go na dysk i wpisujemy ścieżkę — CLI potrafi taki plik odczytać.
 */
export async function POST(req: Request) {
  return handle(req, async () => {
    const body = (await req.json()) as { dataUrl?: string }
    const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(body.dataUrl ?? '')
    if (!match) throw new Error('To nie jest obraz')

    const ext = EXT[match[1].toLowerCase()] ?? 'png'
    const dir = path.join(dataDir(), 'uploads')
    await fs.mkdir(dir, { recursive: true })

    const file = path.join(dir, `${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}.${ext}`)
    await fs.writeFile(file, Buffer.from(match[2], 'base64'))
    return { path: file }
  })
}
