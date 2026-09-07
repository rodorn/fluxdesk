import { handle } from '@/lib/api'
import { readProfile, setShared, syncToClaudeMd, writeSection } from '@/lib/profile'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  return handle(req, () => readProfile())
}

export async function PUT(req: Request) {
  return handle(req, async () => {
    const body = (await req.json()) as {
      key?: string
      value?: unknown
      shared?: boolean
      sync?: boolean
    }
    if (body.sync) return syncToClaudeMd()
    if (!body.key) throw new Error('Podaj sekcję')
    if (body.shared !== undefined) return setShared(body.key, body.shared)
    return writeSection(body.key, body.value)
  })
}

export async function DELETE(req: Request) {
  return handle(req, async () => {
    const key = new URL(req.url).searchParams.get('key')
    if (!key) throw new Error('Podaj sekcję')
    return writeSection(key, undefined)
  })
}
