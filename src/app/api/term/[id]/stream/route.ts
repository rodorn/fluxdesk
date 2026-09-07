import { fail, guard } from '@/lib/api'
import { connectTerminal, getTerminal } from '@/lib/terminals'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Strumień wyjścia terminala. Pierwsze zdarzenie odtwarza dotychczasowy ekran. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = guard(req)
  if (denied) return denied

  const { id } = await ctx.params
  const term = await getTerminal(id)
  if (!term) return fail('Nie znaleziono terminala', 404)

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const write = (event: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          closed = true
        }
      }

      let conn: Awaited<ReturnType<typeof connectTerminal>> | undefined
      try {
        conn = await connectTerminal(id, (msg) => {
          if (msg.t === 'snapshot') write('snapshot', { data: msg.d, info: term })
          else if (msg.t === 'data') write('data', { data: msg.d })
          else if (msg.t === 'exit') write('exit', { code: msg.code })
        })
      } catch {
        write('error', { message: 'Gospodarz terminala nie odpowiada' })
        closed = true
        controller.close()
        return
      }

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
        clearInterval(ping)
        conn?.close()
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
