import { handle } from '@/lib/api'
import { readSessionDetail } from '@/lib/transcript'
import { listTasks } from '@/lib/todo'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/** Rozmowa jako czytelny Markdown: do archiwum albo do pokazania komuś. */
function sessionToMarkdown(detail: Awaited<ReturnType<typeof readSessionDetail>>): string {
  if (!detail) return ''
  const lines: string[] = [`# ${detail.title}`, '']
  if (detail.cwd) lines.push(`Katalog: \`${detail.cwd}\``)
  if (detail.gitBranch) lines.push(`Gałąź: \`${detail.gitBranch}\``)
  lines.push(`Wiadomości: ${detail.entryCount}`, '')

  for (const entry of detail.entries) {
    if (entry.isMeta || entry.isSidechain) continue
    const who = entry.role === 'user' ? 'Ty' : entry.role === 'assistant' ? 'Claude' : 'system'
    const text = entry.blocks
      .map((b) => ('text' in b && typeof b.text === 'string' ? b.text : ''))
      .filter(Boolean)
      .join('\n')
    if (!text.trim()) continue
    lines.push(`## ${who}`, '', text, '')
  }
  return lines.join('\n')
}

export async function GET(req: Request) {
  return handle(req, async () => {
    const params = new URL(req.url).searchParams
    const what = params.get('what')

    if (what === 'tasks') {
      const tasks = await listTasks({ group: 'all' })
      // Format zgodny z taskwarriorem, żeby dało się wrócić, gdyby panel padł.
      return {
        format: 'taskwarrior',
        items: tasks.map((t) => ({
          description: t.title,
          project: t.project,
          tags: t.tags,
          status: t.status === 'zrobione' ? 'completed' : 'pending',
          due: t.due,
          entry: new Date(t.createdAt).toISOString(),
          end: t.closedAt ? new Date(t.closedAt).toISOString() : undefined,
          annotations: t.notes ? [{ description: t.notes }] : undefined,
        })),
      }
    }

    const sessionId = params.get('session')
    if (!sessionId) throw new Error('Podaj sesję albo what=tasks')
    const detail = await readSessionDetail(sessionId)
    if (!detail) throw new Error('Nie znaleziono sesji')
    return { markdown: sessionToMarkdown(detail), title: detail.title }
  })
}
