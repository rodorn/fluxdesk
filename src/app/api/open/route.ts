import { execFile } from 'node:child_process'

import { handle } from '@/lib/api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Otwiera adres w przeglądarce użytkownika. Panel chodzi w oknie aplikacji,
 * więc `window.open` bywa blokowane albo ląduje w tym samym oknie; xdg-open
 * po stronie serwera trafia zawsze tam, gdzie trzeba.
 */
export async function POST(req: Request) {
  return handle(req, async () => {
    const { url } = (await req.json()) as { url?: string }
    let target: URL
    try {
      target = new URL(String(url))
    } catch {
      throw new Error('Niepoprawny adres')
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:')
      throw new Error('Dozwolone są tylko adresy http i https')

    await new Promise<void>((resolve, reject) => {
      execFile('xdg-open', [target.href], { timeout: 5_000 }, (err) =>
        err ? reject(err) : resolve()
      )
    })
    return { opened: target.href }
  })
}
