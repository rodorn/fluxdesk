import { handle } from '@/lib/api'
import {
  createTask,
  deleteTask,
  importFromTaskwarrior,
  createFromTemplate,
  linkSession,
  listTags,
  needsAttention,
  queueForSession,
  TEMPLATES,
  listTasks,
  toggleTimer,
  updateTask,
  type TaskFilter,
  type TaskStatus,
} from '@/lib/todo'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: Request) {
  return handle(req, async () => {
    const params = new URL(req.url).searchParams
    const filter: TaskFilter = {
      status: (params.get('status') as TaskStatus) || undefined,
      group: (params.get('group') as TaskFilter['group']) || undefined,
      project: params.get('project') || undefined,
      tag: params.get('tag') || undefined,
      q: params.get('q') || undefined,
    }
    if (params.get('view') === 'attention') return needsAttention()
    if (params.get('view') === 'templates') {
      return { templates: Object.entries(TEMPLATES).map(([key, t]) => ({ key, ...t })) }
    }
    return { items: await listTasks(filter), tags: await listTags() }
  })
}

export async function POST(req: Request) {
  return handle(req, async () => {
    const body = (await req.json()) as {
      action?:
        | 'create'
        | 'update'
        | 'delete'
        | 'timer'
        | 'link'
        | 'import'
        | 'queue'
        | 'template'
      template?: string
      project?: string
      id?: string
      ids?: string[]
      sessionId?: string
      title?: string
      patch?: Record<string, unknown>
    }

    switch (body.action) {
      case 'import':
        return importFromTaskwarrior()
      case 'create':
        if (!body.title?.trim()) throw new Error('Podaj treść zadania')
        return createTask({ title: body.title, ...(body.patch ?? {}) })
      case 'update':
        if (!body.id) throw new Error('Brak zadania')
        return updateTask(body.id, body.patch ?? {})
      case 'delete':
        if (!body.id) throw new Error('Brak zadania')
        await deleteTask(body.id)
        return { ok: true }
      case 'timer':
        if (!body.id) throw new Error('Brak zadania')
        return toggleTimer(body.id)
      case 'template':
        if (!body.template) throw new Error('Podaj szablon')
        return createFromTemplate(body.template, body.project)
      case 'queue':
        if (!body.sessionId || !body.ids?.length) throw new Error('Brak sesji albo zadań')
        return { queued: await queueForSession(body.sessionId, body.ids) }
      case 'link':
        if (!body.id || !body.sessionId) throw new Error('Brak zadania albo sesji')
        return linkSession(body.id, body.sessionId)
      default:
        throw new Error('Nieznana akcja')
    }
  })
}
