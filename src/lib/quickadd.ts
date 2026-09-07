import { estimateMinutes, parseWithAi, type AiBlock } from "./aiparse";
import { listEvents, type CalendarEvent } from "./calendar";
import { parseQuick, type QuickBlock } from "./quickparse";
import { notify } from "./notify";

/**
 * Wspólna droga dla wpisu w rodzaju „dentysta środa 16": najpierw szybki
 * parser, potem model, na końcu sprawdzenie, czy o tej porze nie ma już czegoś
 * innego. Zwracamy propozycję, a nie gotowy wpis, bo godzinę i długość trzeba
 * móc poprawić przed zapisaniem.
 */

export type Proposal = {
  title: string;
  start: number;
  end: number;
  /** Czy długość jest szacunkiem modelu; wtedy warto ją obejrzeć. */
  estimated: boolean;
  reason?: string;
  /** Skąd wynik: sam parser czy model. */
  source: "parser" | "model";
  /** Co już stoi w tym czasie w kalendarzach. */
  conflicts: { title: string; start: number; end: number; source: string }[];
};

/** Zajętość liczymy z bloków, subskrypcji ICS i obu podłączonych kont. */
async function busyBetween(from: number, to: number): Promise<CalendarEvent[]> {
  const local = await listEvents(from, to).catch(() => [] as CalendarEvent[]);
  let remote: CalendarEvent[] = [];
  try {
    const { fetchRemote } = await import("./calendar-sync");
    remote = await fetchRemote(from, to);
  } catch {
    /* konta niepodłączone albo brak sieci */
  }
  return [...local, ...remote].filter(
    (e) => !e.allDay && e.start < to && e.end > from,
  );
}

export async function propose(
  text: string,
  now = Date.now(),
): Promise<Proposal> {
  const quick = parseQuick(text, now);

  const explicitDuration =
    /\d\s*(h|godz|min|m)\b|[-–]\s*\d{1,2}([:.]\d{2})?/i.test(text);

  // Gdy parser zrozumiał zdanie, model dostaje tylko jedno pytanie: ile to
  // trwa. Data i godzina zostają policzone w kodzie, bo tam nie ma pomyłek,
  // a odpowiedź wraca szybciej i raz zapamiętana nie kosztuje ponownie.
  let chosen: (QuickBlock & { estimated?: boolean; reason?: string }) | undefined =
    quick;
  let ai: AiBlock | undefined;

  if (quick && !explicitDuration) {
    const guess = await estimateMinutes(quick.title);
    if (guess) {
      chosen = {
        ...quick,
        end: quick.start + guess.minutes * 60_000,
        estimated: true,
        reason: guess.reason,
      };
    }
  }

  // Dopiero gdy parser nie zrozumiał zdania, pytamy model o całość.
  if (!quick) {
    ai = await parseWithAi(text, now);
    chosen = ai;
  }

  if (!chosen) throw new Error("Nie rozumiem terminu. Podaj dzień i godzinę");

  const conflicts = (await busyBetween(chosen.start, chosen.end)).map((e) => ({
    title: e.title,
    start: e.start,
    end: e.end,
    source: e.source,
  }));

  if (conflicts.length) {
    const when = new Date(chosen.start).toLocaleString("pl-PL", {
      weekday: "short",
      day: "numeric",
      month: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    void notify({
      title: "Termin się nakłada",
      message: `${chosen.title}, ${when}: w tym czasie jest już ${conflicts.map((c) => c.title).join(", ")}`,
      priority: 4,
      tags: ["kalendarz"],
    }).catch(() => undefined);
  }

  return {
    title: chosen.title,
    start: chosen.start,
    end: chosen.end,
    estimated: Boolean(chosen.estimated),
    reason: chosen.reason,
    source: ai ? "model" : "parser",
    conflicts,
  };
}


/* ------------------------------------------------------------------ */
/* Wspólne wolne okno                                                  */
/* ------------------------------------------------------------------ */

export type Slot = { start: number; end: number };

/**
 * Pierwsze okna, w których wolne są wszystkie podłączone konta naraz.
 * Szukamy w godzinach pracy i w kwadransowej siatce, bo termin o 13:07
 * jest formalnie wolny, ale nikt się tak nie umawia.
 */
export async function findSlots(
  minutes: number,
  options: {
    from?: number;
    days?: number;
    dayStart?: number;
    dayEnd?: number;
    limit?: number;
  } = {},
): Promise<Slot[]> {
  const step = 15 * 60_000;
  const length = minutes * 60_000;
  const from = options.from ?? Date.now();
  const days = options.days ?? 14;
  const dayStart = options.dayStart ?? 8;
  const dayEnd = options.dayEnd ?? 20;
  const limit = options.limit ?? 5;

  const horizon = from + days * 86_400_000;
  const busy = (await busyBetween(from, horizon))
    .map((e) => ({ start: e.start, end: e.end }))
    .sort((a, b) => a.start - b.start);

  const out: Slot[] = [];
  // Zaczynamy od pełnego kwadransa, nigdy od „za trzy minuty".
  let cursor = Math.ceil(from / step) * step;

  while (cursor + length <= horizon && out.length < limit) {
    const at = new Date(cursor);
    const hour = at.getHours() + at.getMinutes() / 60;
    const weekend = at.getDay() === 0 || at.getDay() === 6;

    if (weekend || hour < dayStart || hour + minutes / 60 > dayEnd) {
      // Poza godzinami pracy przeskakujemy na początek następnego dnia.
      const next = new Date(cursor);
      next.setDate(next.getDate() + 1);
      next.setHours(dayStart, 0, 0, 0);
      cursor = next.getTime();
      continue;
    }

    const collision = busy.find(
      (b) => b.start < cursor + length && b.end > cursor,
    );
    if (collision) {
      cursor = Math.ceil(collision.end / step) * step;
      continue;
    }

    out.push({ start: cursor, end: cursor + length });
    cursor += length;
  }

  return out;
}
