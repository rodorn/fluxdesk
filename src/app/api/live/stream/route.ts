import { guard } from '@/lib/api'
import { listLiveSessions, subscribeOverview, type OverviewMessage } from '@/lib/runner'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Zbiorczy strumień SSE: stan wszystkich sesji na żywo w jednym połączeniu.
 * Dzięki niemu pulpit widzi, która sesja czeka na zgodę, bez odpytywania co kilka sekund.
 */
export async function GET(req: Request) {
  const denied = guard(req)
  if (denied) return denied

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      let timer: ReturnType<typeof setTimeout> | undefined

      const write = (name: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          closed = true
        }
      }

      const pushSessions = () => write('sessions', { items: listLiveSessions().map((s) => s.info()) })

      // Snapshoty stanu zbijamy w jedną wysyłkę; zdarzenia idą natychmiast.
      const scheduleSessions = () => {
        if (closed || timer) return
        timer = setTimeout(() => {
          timer = undefined
          pushSessions()
        }, 150)
      }

      pushSessions()
      const unsubscribe = subscribeOverview((msg: OverviewMessage) => {
        if (msg.type === 'event') write('event', { sessionId: msg.sessionId, event: msg.event })
        scheduleSessions()
      })

      const ping = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          closed = true
        }
      }, 15_000)

      req.signal.addEventListener('abort', () => {
        if (closed) return
        closed = true
        if (timer) clearTimeout(timer)
        clearInterval(ping)
        unsubscribe()
        try {
          controller.close()
        } catch {
          /* już zamknięty */
        }
      })
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
