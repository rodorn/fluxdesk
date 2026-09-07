import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { handle } from '@/lib/api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

type Cache = { at: number; data: unknown }
const ref = globalThis as unknown as { __csmGitlab?: Cache }
const TTL_MS = 120_000

/** Token leży w pliku i bywa zapisany z zakończeniem linii w stylu Windows. */
async function token(): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(path.join(os.homedir(), '.config', 'gitlab-token'), 'utf8')
    return raw.replace(/[\r\n]/g, '').trim() || undefined
  } catch {
    return undefined
  }
}

async function gitlab(pathname: string, key: string): Promise<unknown[]> {
  const auth = await token()
  if (!auth) return []
  try {
    const res = await fetch(`https://gitlab.com/api/v4${pathname}`, {
      headers: { 'PRIVATE-TOKEN': auth },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return []
    return (await res.json()) as unknown[]
  } catch {
    void key
    return []
  }
}

/**
 * Merge requesty i zgłoszenia wymagające reakcji. Panel pokazuje to obok sesji,
 * żeby nie trzeba było zaglądać do przeglądarki po sam fakt „coś na mnie czeka”.
 */
export async function GET(req: Request) {
  return handle(req, async () => {
    const cached = ref.__csmGitlab
    if (cached && Date.now() - cached.at < TTL_MS) return cached.data

    const [mine, review, issues] = await Promise.all([
      gitlab('/merge_requests?scope=created_by_me&state=opened&per_page=20', 'mine'),
      gitlab('/merge_requests?scope=assigned_to_me&state=opened&per_page=20', 'review'),
      gitlab('/issues?scope=assigned_to_me&state=opened&per_page=20', 'issues'),
    ])

    const shape = (raw: unknown[]) =>
      (raw as Record<string, unknown>[]).map((m) => ({
        id: m.iid,
        title: String(m.title ?? ''),
        url: String(m.web_url ?? ''),
        project: String((m.references as { full?: string } | undefined)?.full ?? '').split('!')[0],
        updatedAt: typeof m.updated_at === 'string' ? Date.parse(m.updated_at) : undefined,
        draft: m.draft === true,
      }))

    const data = {
      configured: Boolean(await token()),
      mine: shape(mine),
      review: shape(review),
      issues: shape(issues),
    }
    ref.__csmGitlab = { at: Date.now(), data }
    return data
  })
}
