import { handle } from '@/lib/api'
import { startTerminal } from '@/lib/terminals'
import { notify } from '@/lib/notify'
import { readStore } from '@/lib/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Wejście dla zdarzeń z zewnątrz. Coś się dzieje w innym systemie, a panel
 * może na to odpowiedzieć: powiadomić albo od razu uruchomić sesję.
 *
 * Wywołanie wymaga tokenu, bo uruchamia procesy na tej maszynie.
 */
export async function POST(req: Request) {
  return handle(req, async () => {
    const body = (await req.json()) as {
      event: string
      message?: string
      /** Katalog, w którym ma ruszyć sesja; bez niego tylko powiadamiamy. */
      cwd?: string
      prompt?: string
      model?: string
    }
    if (!body.event) throw new Error('Podaj nazwę zdarzenia')

    const store = await readStore()
    const known = store.repos.some((r) => r.path === body.cwd)

    void notify({
      title: `Zdarzenie: ${body.event}`,
      message: body.message ?? body.prompt ?? '',
      priority: 3,
      tags: ['zap'],
    })

    if (!body.cwd || !body.prompt) return { handled: 'powiadomienie' }
    if (!known) throw new Error('Katalog nie jest wpiętym repozytorium')

    const term = await startTerminal({
      cwd: body.cwd,
      title: `${body.event}`,
      model: body.model,
      permissionMode: 'bypassPermissions',
    })
    return { handled: 'sesja', id: term.id }
  })
}
