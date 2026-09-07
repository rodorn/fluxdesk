import fs from 'node:fs/promises'
import path from 'node:path'

import { handle } from '@/lib/api'
import { dataDir } from '@/lib/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export type Prompt = {
  id: string
  name: string
  body: string
  tags: string[]
  uses: number
  updatedAt: number
}

function file(): string {
  return path.join(dataDir(), 'prompts.json')
}

async function read(): Promise<Prompt[]> {
  try {
    return JSON.parse(await fs.readFile(file(), 'utf8')) as Prompt[]
  } catch {
    return []
  }
}

async function write(items: Prompt[]): Promise<void> {
  await fs.mkdir(path.dirname(file()), { recursive: true })
  await fs.writeFile(file(), JSON.stringify(items, null, 2), 'utf8')
}

/** Sprawdzone polecenia pod ręką; te same rzeczy pisze się w kółko. */
export async function GET(req: Request) {
  return handle(req, async () => ({ items: (await read()).sort((a, b) => b.uses - a.uses) }))
}

export async function POST(req: Request) {
  return handle(req, async () => {
    const body = (await req.json()) as {
      action: 'save' | 'delete' | 'used'
      id?: string
      name?: string
      body?: string
      tags?: string[]
    }
    const items = await read()

    if (body.action === 'delete') {
      await write(items.filter((p) => p.id !== body.id))
      return { ok: true }
    }
    if (body.action === 'used') {
      const found = items.find((p) => p.id === body.id)
      if (found) found.uses++
      await write(items)
      return { ok: true }
    }

    if (!body.name?.trim() || !body.body?.trim()) throw new Error('Podaj nazwę i treść')
    const existing = items.find((p) => p.id === body.id)
    if (existing) {
      Object.assign(existing, {
        name: body.name,
        body: body.body,
        tags: body.tags ?? existing.tags,
        updatedAt: Date.now(),
      })
    } else {
      items.push({
        id: crypto.randomUUID(),
        name: body.name,
        body: body.body,
        tags: body.tags ?? [],
        uses: 0,
        updatedAt: Date.now(),
      })
    }
    await write(items)
    return { items }
  })
}
