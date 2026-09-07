import { NextResponse } from 'next/server'

import { accessToken } from './config'

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init)
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

/** Zwraca odpowiedź 401, gdy skonfigurowano token i żądanie go nie ma. */
export function guard(req: Request): NextResponse | undefined {
  const token = accessToken()
  if (!token) return undefined
  const header = req.headers.get('x-csm-token')
  const cookie = req.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('csm_token='))
    ?.slice('csm_token='.length)
  if (header === token || cookie === token) return undefined
  return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 })
}

export async function handle<T>(
  req: Request,
  fn: () => Promise<T>
): Promise<NextResponse | Response> {
  const denied = guard(req)
  if (denied) return denied
  try {
    return NextResponse.json(await fn())
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
