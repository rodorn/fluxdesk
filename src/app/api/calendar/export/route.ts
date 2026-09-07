import { exportIcs } from '@/lib/calendar'
import { guard } from '@/lib/api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Bloki z panelu jako kalendarz do zasubskrybowania. Google i Outlook potrafią
 * dodać kalendarz z adresu, więc czas zaplanowany tutaj widać po drugiej stronie
 * bez rejestrowania aplikacji w ich konsolach.
 */
export async function GET(req: Request) {
  const denied = guard(req)
  if (denied) return denied

  return new Response(await exportIcs(), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="fluxdesk.ics"',
      'Cache-Control': 'no-cache',
    },
  })
}
