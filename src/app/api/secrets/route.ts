import { handle } from '@/lib/api'
import { deleteSecret, listSecrets, revealSecret, saveSecret } from '@/lib/secrets'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  return handle(req, async () => {
    const reveal = new URL(req.url).searchParams.get('reveal')
    if (reveal) return { name: reveal, value: await revealSecret(reveal) }
    return { items: await listSecrets() }
  })
}

export async function PUT(req: Request) {
  return handle(req, async () => {
    const body = (await req.json()) as {
      name?: string
      value?: string
      description?: string
      envVar?: string
      exposed?: boolean
    }
    if (!body.name) throw new Error('Podaj nazwę sekretu')
    return { items: await saveSecret({ ...body, name: body.name }) }
  })
}

export async function DELETE(req: Request) {
  return handle(req, async () => {
    const name = new URL(req.url).searchParams.get('name')
    if (!name) throw new Error('Podaj nazwę sekretu')
    return { items: await deleteSecret(name) }
  })
}
