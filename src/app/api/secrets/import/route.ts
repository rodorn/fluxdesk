import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { handle } from '@/lib/api'
import { saveSecret } from '@/lib/secrets'
import { readStore } from '@/lib/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

const ENV_FILES = ['.env', '.env.local', '.env.production', '.env.development']

/** Wartość wygląda na sekret, a nie na zwykłe ustawienie w rodzaju PORT=3000. */
function looksSecret(key: string, value: string): boolean {
  if (value.length < 8) return false
  return /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|API|CREDENTIAL|DSN|WEBHOOK|PRIVATE)/i.test(key)
}

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).replace(/^export\s+/, '').trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key && value) out[key] = value
  }
  return out
}

/** Zbiera sekrety z plików .env wpiętych repozytoriów i z paru znanych miejsc. */
export async function POST(req: Request) {
  return handle(req, async () => {
    const body = (await req.json().catch(() => ({}))) as { all?: boolean }
    const store = await readStore()
    const home = os.homedir()

    const found: { name: string; value: string; description: string }[] = []

    for (const repo of store.repos) {
      for (const file of ENV_FILES) {
        const full = path.join(repo.path, file)
        let text: string
        try {
          text = await fsp.readFile(full, 'utf8')
        } catch {
          continue
        }
        for (const [key, value] of Object.entries(parseEnv(text))) {
          if (!body.all && !looksSecret(key, value)) continue
          found.push({
            name: `${repo.name}/${key}`,
            value,
            description: `z ${file} w ${repo.name}`,
          })
        }
      }
    }

    // Pojedyncze pliki z tokenami, trzymane poza repozytoriami.
    const loose = [{ file: path.join(home, '.config', 'gitlab-token'), name: 'gitlab/token' }]
    for (const item of loose) {
      try {
        const value = (await fsp.readFile(item.file, 'utf8')).trim()
        if (value) found.push({ name: item.name, value, description: `z ${item.file}` })
      } catch {
        /* brak pliku */
      }
    }

    let added = 0
    for (const secret of found) {
      await saveSecret({ ...secret, exposed: false })
      added++
    }

    return { added, sources: [...new Set(found.map((f) => f.description))].length }
  })
}
