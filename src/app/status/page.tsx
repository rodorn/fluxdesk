import { listTerminals } from '@/lib/terminals'
import { listTasks } from '@/lib/todo'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Publiczna strona stanu. Pokazuje postęp bez wnętrza rozmów: nazwy zadań,
 * ich status i liczbę pracujących sesji. Do wysłania klientowi albo na drugi ekran.
 */
/** Dane pokazowe: te same widoki bez ujawniania czegokolwiek prawdziwego. */
const DEMO = [
  { id: 'd1', title: 'Integracja formularza z CRM', status: 'in_progress', project: 'klient A' },
  { id: 'd2', title: 'Automatyczny raport tygodniowy', status: 'testowanie', project: 'klient A' },
  { id: 'd3', title: 'Import ofert z pliku', status: 'to_do', project: 'klient B' },
  { id: 'd4', title: 'Powiadomienia o nowym leadzie', status: 'zrobione', project: 'klient B' },
]

export default async function StatusPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>
}) {
  const params = await searchParams
  if (params.demo) {
    return (
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-10">
        <header>
          <h1 className="text-xl font-semibold">Stan prac</h1>
          <p className="mt-1 text-sm muted">widok pokazowy, dane przykładowe</p>
        </header>
        {['in_progress', 'testowanie', 'to_do', 'zrobione'].map((status) => (
          <section key={status} className="panel px-4 py-3">
            <h2 className="mb-2 text-sm font-semibold">{status}</h2>
            <ul className="space-y-1">
              {DEMO.filter((d) => d.status === status).map((d) => (
                <li key={d.id} className="flex items-baseline gap-2 text-sm">
                  <span className="min-w-0 flex-1">{d.title}</span>
                  <span className="text-xs muted">{d.project}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    )
  }

  const [terminals, tasks] = await Promise.all([listTerminals(), listTasks({ group: 'all' })])
  const active = terminals.filter((t) => t.alive)
  const groups = [
    { label: 'W trakcie', items: tasks.filter((t) => t.status === 'in_progress') },
    { label: 'Do zrobienia', items: tasks.filter((t) => t.status === 'to_do').slice(0, 12) },
    { label: 'Testowanie', items: tasks.filter((t) => t.status === 'testowanie').slice(0, 12) },
    {
      label: 'Zamknięte w tym tygodniu',
      items: tasks
        .filter((t) => t.closedAt && Date.now() - t.closedAt < 7 * 86_400_000)
        .slice(0, 12),
    },
  ]

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-10">
      <header>
        <h1 className="text-xl font-semibold">Stan prac</h1>
        <p className="mt-1 text-sm muted">
          {active.length} sesji pracuje · {new Date().toLocaleString('pl-PL')}
        </p>
      </header>

      {groups.map((g) => (
        <section key={g.label} className="panel px-4 py-3">
          <h2 className="mb-2 text-sm font-semibold">
            {g.label} <span className="muted">· {g.items.length}</span>
          </h2>
          <ul className="space-y-1">
            {g.items.map((t) => (
              <li key={t.id} className="flex items-baseline gap-2 text-sm">
                <span className="min-w-0 flex-1">{t.title}</span>
                {t.project ? <span className="text-xs muted">{t.project}</span> : null}
              </li>
            ))}
            {g.items.length === 0 ? <li className="text-xs muted">nic tutaj</li> : null}
          </ul>
        </section>
      ))}
    </div>
  )
}
