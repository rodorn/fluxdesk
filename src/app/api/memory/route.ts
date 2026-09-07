import { handle } from '@/lib/api'
import {
  deleteMemory,
  findConflicts,
  listMemory,
  readMemory,
  writeMemory,
} from '@/lib/memory'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  return handle(req, async () => {
    const params = new URL(req.url).searchParams
    const cwd = params.get('cwd') || undefined
    if (params.get('view') === 'conflicts') return { conflicts: await findConflicts(cwd) }
    const id = params.get('id')
    if (id) return { id, content: await readMemory(id, cwd) }
    return { items: await listMemory(cwd) }
  })
}

export async function PUT(req: Request) {
  return handle(req, async () => {
    const body = (await req.json()) as { id?: string; cwd?: string; content?: string }
    if (!body.id) throw new Error('Brak identyfikatora')
    if (typeof body.content !== 'string') throw new Error('Brak treści')
    return writeMemory(body.id, body.cwd, body.content)
  })
}

export async function DELETE(req: Request) {
  return handle(req, async () => {
    const params = new URL(req.url).searchParams
    const id = params.get('id')
    if (!id) throw new Error('Brak identyfikatora')
    return deleteMemory(id, params.get('cwd') || undefined)
  })
}
