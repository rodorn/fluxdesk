import { execFile } from 'node:child_process'

import { handle } from '@/lib/api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Otwiera adres w przeglądarce użytkownika. Panel chodzi w oknie aplikacji,
 * więc `window.open` bywa blokowane albo ląduje w tym samym oknie; xdg-open
 * po stronie serwera trafia zawsze tam, gdzie trzeba.
 */

/**
 * Zamienia adres spotkania na odpowiednik otwierany przez aplikację, gdy taka
 * jest zainstalowana. Klient w oknie programu działa lepiej niż wersja
 * przeglądarkowa: ma dźwięk, udostępnianie ekranu i nie gubi się w kartach.
 */
function appLink(url: URL): URL {
  if (url.protocol !== 'https:') return url

  if (/(^|\.)teams\.microsoft\.com$|(^|\.)teams\.live\.com$/.test(url.hostname)) {
    return new URL(`msteams://${url.host}${url.pathname}${url.search}`)
  }
  if (/(^|\.)zoom\.us$/.test(url.hostname)) {
    const meeting = /\/j\/(\d+)/.exec(url.pathname)
    const password = new URLSearchParams(url.search).get('pwd')
    if (meeting) {
      return new URL(
        `zoommtg://zoom.us/join?confno=${meeting[1]}${password ? `&pwd=${password}` : ''}`
      )
    }
  }
  return url
}

export async function POST(req: Request) {
  return handle(req, async () => {
    const { url } = (await req.json()) as { url?: string }
    let target: URL
    try {
      target = new URL(String(url))
    } catch {
      throw new Error('Niepoprawny adres')
    }

    // Schematy aplikacji spotkań: klik ma otwierać program, nie kartę.
    const APP_SCHEMES = ['msteams:', 'zoommtg:', 'zoomus:']
    const isWeb = target.protocol === 'http:' || target.protocol === 'https:'
    if (!isWeb && !APP_SCHEMES.includes(target.protocol)) {
      throw new Error('Dozwolone są adresy http, https i linki spotkań')
    }

    await new Promise<void>((resolve, reject) => {
      execFile('xdg-open', [appLink(target).href], { timeout: 5_000 }, (err) =>
        err ? reject(err) : resolve()
      )
    })
    return { opened: appLink(target).href }
  })
}
