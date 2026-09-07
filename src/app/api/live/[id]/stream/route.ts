import { fail, guard } from '@/lib/api'
import { getLiveSession } from '@/lib/runner'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Strumień SSE ze zdarzeniami sesji. Parametr `cursor` pozwala wznowić
 * strumień po przeładowaniu strony bez gubienia zdarzeń.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = guard(req)
  if (denied) return denied

  const { id } = await ctx.params
  const session = getLiveSession(id)
  if (!session) return fail('Nie znaleziono sesji na żywo', 404)

  const cursor = Number(new URL(req.url).searchParams.get('cursor') ?? '-1')
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      const write = (event: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          closed = true
        }
      }

      write('info', session.info())
      for (const e of session.eventsSince(cursor)) write('event', e)

      const unsubscribe = session.subscribe((e) => {
        write('event', e)
        write('info', session.info())
      })

      // Keep-alive, żeby proxy nie zerwało połączenia.
      const ping = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          closed = true
        }
      }, 15_000)

      const cleanup = () => {
        if (closed) return
        closed = true
        clearInterval(ping)
        unsubscribe()
        try {
          controller.close()
        } catch {
          /* już zamknięty */
        }
      }

      req.signal.addEventListener('abort', cleanup)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
