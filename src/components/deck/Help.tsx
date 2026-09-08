'use client'

import { Overlay } from '@/components/deck/Overlay'

/**
 * Dwie warstwy: goły klawisz działa, gdy nie piszesz w polu; ten sam klawisz
 * z Ctrl+Alt działa zawsze, także w trakcie pisania.
 */
const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Sesje',
    rows: [
      ['1 … 9', 'przejdź do sesji o tym numerze'],
      ['T', 'nowy terminal (pełny claude)'],
      ['J / K', 'następna / poprzednia sesja'],
      ['A', 'skocz do sesji czekającej na zgodę'],
      ['N', 'nowa sesja (nazwa, katalog, model, bypass)'],
      ['R', 'wznów zapisaną sesję'],
      ['W', 'zamknij bieżącą sesję'],
      ['X', 'przywróć ostatnio zamkniętą'],
    ],
  },
  {
    title: 'Praca w sesji',
    rows: [
      ['Enter', 'wyślij; w trakcie tury prompt idzie do kolejki'],
      ['Shift+Enter', 'nowa linia'],
      ['Esc', 'przerwij turę (gdy pole tekstowe puste)'],
      ['Y / A / N', 'zgoda: zezwól / zawsze / odrzuć'],
      ['U', 'przełącz tryb uprawnień'],
      ['I', 'kursor do pola tekstowego'],
      ['↑ / ↓', 'historia własnych promptów w pustym polu'],
    ],
  },
  {
    title: 'Widok',
    rows: [
      ['G', 'siatka wszystkich sesji / pojedyncza konsola'],
      ['S', 'przejdź do sesji po nazwie'],
      ['Z', 'zadania'],
      ['B', 'tablica zadań'],
      ['L', 'GitLab: MR i zgłoszenia'],
      ['Y', 'puls: usługi i zmiany w repo'],
      ['C', 'uwaga: cel dnia i czas pracy'],
      ['E', 'projekty i ich stan'],
      ['Q', 'kalendarz i planowanie dnia'],
      ['V', 'pełny ekran jednej rozmowy'],
      ['D', 'dziennik dnia'],
      ['/', 'szukaj we wszystkich rozmowach'],
      ['F', 'tryb skupienia (jedna sesja, reszta cicho)'],
      ['O', 'dwie sesje obok siebie'],
      ['P', 'paleta poleceń'],
      ['M', 'pamięć, profil i sejf'],
      ['Alt+,', 'ustawienia: język, powiadomienia, zgody, kalendarze'],
      ['F5 lub Ctrl+Alt+R', 'przeładuj panel'],
      ['H lub ?', 'ta pomoc'],
    ],
  },
]

export function Help({ onClose }: { onClose: () => void }) {
  return (
    <Overlay
      title="Skróty klawiszowe"
      hint="goły klawisz, gdy nie piszesz · Ctrl+Alt+klawisz zawsze · Esc zamyka"
      onClose={onClose}
      wide
    >
      <div className="grid gap-5 sm:grid-cols-2">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="mb-2 text-xs font-semibold muted">{g.title}</h3>
            <ul className="space-y-1">
              {g.rows.map(([keys, desc]) => (
                <li key={keys} className="flex items-baseline gap-3 text-xs">
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 mono text-[10px]"
                    style={{ background: 'var(--panel-2)' }}
                  >
                    {keys}
                  </span>
                  <span className="muted">{desc}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Overlay>
  )
}
