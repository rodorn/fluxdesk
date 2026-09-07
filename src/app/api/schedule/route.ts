import { handle } from '@/lib/api'
import { readSchedule, writeSchedule, type Scheduled } from '@/lib/schedule'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  return handle(req, async () => ({ items: await readSchedule() }))
}

export async function POST(req: Request) {
  return handle(req, async () => {
    const body = (await req.json()) as {
      action: 'save' | 'delete' | 'toggle'
      item?: Scheduled
      id?: string
    }
    const items = await readSchedule()

    if (body.action === 'delete') {
      await writeSchedule(items.filter((i) => i.id !== body.id))
      return { items: await readSchedule() }
    }
    if (body.action === 'toggle') {
      const found = items.find((i) => i.id === body.id)
      if (found) found.enabled = !found.enabled
      await writeSchedule(items)
      return { items }
    }

    if (!body.item?.cwd || !body.item.prompt || !body.item.at) {
      throw new Error('Podaj katalog, prompt i godzinę')
    }
    const item: Scheduled = {
      ...body.item,
      id: body.item.id || crypto.randomUUID(),
      days: body.item.days ?? [],
      enabled: body.item.enabled ?? true,
    }
    const rest = items.filter((i) => i.id !== item.id)
    await writeSchedule([...rest, item])
    return { items: [...rest, item] }
  })
}
