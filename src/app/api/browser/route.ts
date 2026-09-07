import { handle } from '@/lib/api'
import { browserStatus, startBrowser } from '@/lib/browser'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: Request) {
  return handle(req, () => browserStatus())
}

export async function POST(req: Request) {
  return handle(req, () => startBrowser())
}

/**
 * Podpowiedź dla sesji: jak dostać się do przeglądarki działającej w tle.
 * Bez tego sesje nie wiedzą, że mogą jej użyć, i próbują otwierać własną.
 */
export async function PUT(req: Request) {
  return handle(req, async () => {
    const status = await browserStatus()
    if (!status.running) throw new Error('Przeglądarka w tle nie działa')
    return {
      prompt: [
        'Na tej maszynie działa Chrome na wirtualnym ekranie, gotowy do sterowania.',
        `Protokół CDP: http://127.0.0.1:${status.cdpPort}`,
        `Ekran: DISPLAY=${status.display}`,
        'Używaj go zamiast uruchamiania własnej przeglądarki i nie ruszaj okien użytkownika.',
      ].join('\n'),
    }
  })
}
