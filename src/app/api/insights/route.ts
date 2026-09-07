import { handle } from '@/lib/api'
import { connectTerminal, getTerminal } from '@/lib/terminals'
import { screenLines } from '@/lib/termstate'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Zdania, które zwykle niosą ustalenie warte zapamiętania. */
const SIGNALS =
  /(ustaliliśmy|okazało się|przyczyn[aąy]|nie działa|zadziałało|pamiętaj|na przyszłość|błąd był|rozwiązanie|wniosek|uwaga:)/i

/**
 * Propozycje wpisów do pamięci wyciągnięte z ekranu sesji. Panel niczego nie
 * zapisuje sam: pokazuje kandydatów, a decyzja i tak należy do człowieka.
 */
export async function GET(req: Request) {
  return handle(req, async () => {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) throw new Error('Podaj sesję')
    const term = await getTerminal(id)
    if (!term) throw new Error('Nie znaleziono sesji')

    const screen = await new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve(''), 1500)
      connectTerminal(id, (msg) => {
        if (msg.t !== 'snapshot') return
        clearTimeout(timer)
        resolve(msg.d)
      })
        .then((conn) => setTimeout(() => conn.close(), 1600))
        .catch(() => {
          clearTimeout(timer)
          resolve('')
        })
    })

    const candidates = screenLines(screen)
      .filter((l) => l.length > 40 && l.length < 300)
      .filter((l) => SIGNALS.test(l))
      .map((l) => l.replace(/^[●•]\s*/, ''))
      .slice(-8)

    return { title: term.title, cwd: term.cwd, candidates }
  })
}
