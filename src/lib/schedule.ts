import fs from 'node:fs/promises'
import path from 'node:path'

import { dataDir } from './store'

/** Sesje odpalane o stałej porze: raport rano, porządki wieczorem. */
export type Scheduled = {
  id: string
  /** Godzina w formacie 24-godzinnym, na przykład „08:00”. */
  at: string
  /** Dni tygodnia, 1 to poniedziałek; puste znaczy codziennie. */
  days: number[]
  cwd: string
  prompt: string
  model?: string
  enabled: boolean
  lastRun?: number
}

function file(): string {
  return path.join(dataDir(), 'schedule.json')
}

export async function readSchedule(): Promise<Scheduled[]> {
  try {
    return JSON.parse(await fs.readFile(file(), 'utf8')) as Scheduled[]
  } catch {
    return []
  }
}

export async function writeSchedule(items: Scheduled[]): Promise<void> {
  await fs.mkdir(path.dirname(file()), { recursive: true })
  await fs.writeFile(file(), JSON.stringify(items, null, 2), 'utf8')
}
