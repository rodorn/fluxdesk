import { listTasks, OPEN, type Task } from "./todo";
import { busyBetween } from "./quickadd";

/**
 * Układanie zadań w wolnych oknach. Nie chodzi o wypełnienie kalendarza po
 * brzegi, tylko o odpowiedź na pytanie „kiedy to zrobię": zadanie bez godziny
 * w kalendarzu zwykle nie zostaje zrobione.
 *
 * Zasady wzięte z tego, jak plan psuje się w praktyce:
 * termin decyduje o kolejności, długie zadania idą na rano, dzień ma limit,
 * a między blokami zostaje oddech, bo plan bez luzu rozsypuje się po pierwszym
 * poślizgu.
 */

export type PlannedBlock = {
  taskId: string;
  title: string;
  start: number;
  end: number;
  /** Dlaczego akurat tu; pokazujemy to przy propozycji. */
  reason: string;
};

export type PlanOptions = {
  from?: number;
  days?: number;
  dayStart?: number;
  dayEnd?: number;
  /** Ile minut pracy zaplanować na jeden dzień. */
  dailyLimitMin?: number;
  /** Przerwa między blokami. */
  gapMin?: number;
  /** Najdłuższy pojedynczy blok; dłuższe zadania dzielimy. */
  chunkMin?: number;
  limit?: number;
};

const DEFAULT_MINUTES = 45;

/** Termin jako liczba; brak terminu to koniec kolejki, nie początek. */
function dueAt(task: Task): number {
  if (!task.due) return Number.POSITIVE_INFINITY;
  const at = Date.parse(task.due);
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at;
}

/**
 * Kolejność: najpierw to, co ma termin najbliżej, potem priorytet, a na końcu
 * wiek zadania, żeby stare rzeczy nie wisiały w nieskończoność.
 */
function urgency(a: Task, b: Task): number {
  const dueA = dueAt(a);
  const dueB = dueAt(b);
  // Odejmowanie nie wystarczy: różnica dwóch nieskończoności to NaN, a wtedy
  // zadanie z terminem przegrywało z bezterminowym.
  const hasA = Number.isFinite(dueA);
  const hasB = Number.isFinite(dueB);
  if (hasA !== hasB) return hasA ? -1 : 1;
  if (hasA && hasB && dueA !== dueB) return dueA - dueB;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.createdAt - b.createdAt;
}

function startOfDay(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export async function planTasks(
  options: PlanOptions = {},
): Promise<PlannedBlock[]> {
  const from = options.from ?? Date.now();
  const days = options.days ?? 7;
  const dayStart = options.dayStart ?? 9;
  const dayEnd = options.dayEnd ?? 18;
  const dailyLimit = options.dailyLimitMin ?? 240;
  const gap = (options.gapMin ?? 10) * 60_000;
  const chunk = options.chunkMin ?? 90;
  const limit = options.limit ?? 12;

  const horizon = from + days * 86_400_000;

  const tasks = (await listTasks({}))
    .filter((t) => OPEN.includes(t.status))
    .filter((t) => !t.assignedTo)
    // Zablokowane zadania nie mają sensu w planie: i tak się ich nie zacznie.
    .filter((t) => !t.blockedBy?.length)
    .sort(urgency);
  if (!tasks.length) return [];

  const busy = (await busyBetween(from, horizon))
    .map((e) => ({ start: e.start, end: e.end }))
    .sort((a, b) => a.start - b.start);

  const planned: PlannedBlock[] = [];
  const perDay = new Map<number, number>();
  const step = 15 * 60_000;

  for (const task of tasks) {
    if (planned.length >= limit) break;

    const total = task.estimateMin ?? DEFAULT_MINUTES;
    // Długie zadanie dzielimy na części: trzy godziny bez przerwy i tak nie
    // wychodzą, a mniejszy kawałek łatwiej wcisnąć między spotkania.
    const parts: number[] = [];
    let left = total;
    while (left > 0) {
      const piece = Math.min(left, chunk);
      parts.push(piece);
      left -= piece;
    }

    const deadline = dueAt(task);

    for (const minutes of parts) {
      const length = minutes * 60_000;
      let cursor = Math.ceil(from / step) * step;
      let placed = false;

      while (cursor + length <= horizon && !placed) {
        const at = new Date(cursor);
        const hour = at.getHours() + at.getMinutes() / 60;
        const weekend = at.getDay() === 0 || at.getDay() === 6;
        const day = startOfDay(cursor);

        const nextDay = () => {
          const d = new Date(cursor);
          d.setDate(d.getDate() + 1);
          d.setHours(dayStart, 0, 0, 0);
          cursor = d.getTime();
        };

        if (weekend || hour < dayStart || hour + minutes / 60 > dayEnd) {
          nextDay();
          continue;
        }

        // Dzienny limit pracy nad zadaniami; reszta dnia zostaje na spotkania
        // i rzeczy, których nikt nie planuje.
        if ((perDay.get(day) ?? 0) + minutes > dailyLimit) {
          nextDay();
          continue;
        }

        const collision = [...busy, ...planned].find(
          (b) => b.start < cursor + length + gap && b.end + gap > cursor,
        );
        if (collision) {
          cursor = Math.ceil((collision.end + gap) / step) * step;
          continue;
        }

        // Zadanie z przyszłym terminem musi zmieścić się przed nim; zadania
        // już przeterminowanego nie odrzucamy, bo to właśnie ono jest pilne.
        const future = Number.isFinite(deadline) && deadline > from;
        if (future && cursor + length > deadline + 86_400_000) break;

        const reasons: string[] = [];
        if (Number.isFinite(deadline)) {
          const daysLeft = Math.round((deadline - cursor) / 86_400_000);
          reasons.push(
            daysLeft < 0
              ? `${-daysLeft} dni po terminie`
              : daysLeft === 0
                ? "termin dziś"
                : `termin za ${daysLeft} dni`,
          );
        }
        if (task.priority === 2) reasons.push("pilne");
        else if (task.priority === 1) reasons.push("ważne");
        if (parts.length > 1) reasons.push(`część z ${total} min`);
        if (!reasons.length) reasons.push("pierwsze wolne okno");

        planned.push({
          taskId: task.id,
          title: task.title,
          start: cursor,
          end: cursor + length,
          reason: reasons.join(", "),
        });
        perDay.set(day, (perDay.get(day) ?? 0) + minutes);
        placed = true;
      }

      if (!placed) break;
    }
  }

  return planned.sort((a, b) => a.start - b.start);
}
