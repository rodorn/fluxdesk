import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { dataDir } from "./store";

/**
 * Kalendarz. Odczyt idzie przez prywatne adresy ICS, które Google i Outlook
 * udostępniają bez zakładania aplikacji w ich konsolach: wystarczy wkleić link.
 * Bloki czasu zakładane w panelu trzymamy u siebie i wystawiamy własnym ICS-em,
 * żeby dało się je zasubskrybować po drugiej stronie.
 *
 * Pełny zapis przez Graph i Google Calendar API wymaga rejestracji aplikacji,
 * więc jest osobnym krokiem; ten moduł działa bez niego.
 */

export type CalendarSource = {
  id: string;
  name: string;
  /** Prywatny adres ICS z Google albo Outlooka. */
  url: string;
  /** Kolor wydarzeń z tego źródła. */
  color: string;
  enabled: boolean;
  lastSync?: number;
  lastError?: string;
};

export type CalendarEvent = {
  id: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  source: string;
  color: string;
  location?: string;
  /** Blok założony w panelu; tylko takie da się edytować. */
  own?: boolean;
  taskId?: string;
  /** Odpowiedniki po stronie dostawców, gdy blok jest z nimi zsynchronizowany. */
  remote?: { google?: string; microsoft?: string };
};

type Store = {
  version: 1;
  sources: CalendarSource[];
  blocks: (CalendarEvent & { own: true })[];
};

function file(): string {
  return path.join(dataDir(), "calendar.json");
}

async function read(): Promise<Store> {
  try {
    return JSON.parse(await fs.readFile(file(), "utf8")) as Store;
  } catch {
    return { version: 1, sources: [], blocks: [] };
  }
}

async function write(store: Store): Promise<void> {
  await fs.mkdir(path.dirname(file()), { recursive: true });
  await fs.writeFile(file(), JSON.stringify(store, null, 2), "utf8");
}

/* ------------------------------------------------------------------ */
/* Parser ICS                                                          */
/* ------------------------------------------------------------------ */

/** Długie linie ICS są łamane i kontynuowane spacją albo tabulatorem. */
function unfold(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n");
}

/** Daty ICS: 20260907T140000Z, 20260907T140000 albo 20260907 dla całego dnia. */
function parseIcsDate(
  value: string,
): { at: number; allDay: boolean } | undefined {
  const clean = value.trim();
  const utc = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(clean);
  if (utc) {
    return {
      at: Date.UTC(+utc[1], +utc[2] - 1, +utc[3], +utc[4], +utc[5], +utc[6]),
      allDay: false,
    };
  }
  const local = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(clean);
  if (local) {
    return {
      at: new Date(
        +local[1],
        +local[2] - 1,
        +local[3],
        +local[4],
        +local[5],
        +local[6],
      ).getTime(),
      allDay: false,
    };
  }
  const day = /^(\d{4})(\d{2})(\d{2})$/.exec(clean);
  if (day) {
    return {
      at: new Date(+day[1], +day[2] - 1, +day[3]).getTime(),
      allDay: true,
    };
  }
  return undefined;
}

/**
 * Rozwija powtarzalność w zadanym oknie. Obsługujemy dzienne, tygodniowe,
 * miesięczne i roczne, bo tak zapisana jest większość spotkań cyklicznych.
 */
function expand(
  start: number,
  end: number,
  rrule: string | undefined,
  from: number,
  to: number,
): { start: number; end: number }[] {
  const base = [{ start, end }];
  if (!rrule) return start < to && end > from ? base : [];

  const freq = /FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/.exec(rrule)?.[1];
  if (!freq) return start < to && end > from ? base : [];

  const interval = Number(/INTERVAL=(\d+)/.exec(rrule)?.[1] ?? 1);
  const until = /UNTIL=([0-9TZ]+)/.exec(rrule)?.[1];
  const untilAt = until ? parseIcsDate(until)?.at : undefined;
  const count = Number(/COUNT=(\d+)/.exec(rrule)?.[1] ?? 0);

  const out: { start: number; end: number }[] = [];
  const duration = end - start;
  const cursor = new Date(start);
  let made = 0;

  // Sto powtórzeń wystarczy na każde okno, które pokazuje panel.
  for (let i = 0; i < 400; i++) {
    const at = cursor.getTime();
    if (untilAt && at > untilAt) break;
    if (count && made >= count) break;
    if (at > to) break;
    if (at + duration > from) {
      out.push({ start: at, end: at + duration });
      made++;
    }

    if (freq === "DAILY") cursor.setDate(cursor.getDate() + interval);
    else if (freq === "WEEKLY") cursor.setDate(cursor.getDate() + 7 * interval);
    else if (freq === "MONTHLY") cursor.setMonth(cursor.getMonth() + interval);
    else cursor.setFullYear(cursor.getFullYear() + interval);
  }
  return out;
}

export function parseIcs(
  text: string,
  source: CalendarSource,
  from: number,
  to: number,
): CalendarEvent[] {
  const lines = unfold(text);
  const events: CalendarEvent[] = [];

  let current: Record<string, string> | undefined;
  for (const line of lines) {
    if (line.startsWith("BEGIN:VEVENT")) {
      current = {};
      continue;
    }
    if (line.startsWith("END:VEVENT")) {
      if (!current) continue;
      const startRaw = current.DTSTART;
      const endRaw = current.DTEND ?? current.DTSTART;
      const start = startRaw ? parseIcsDate(startRaw) : undefined;
      const end = endRaw ? parseIcsDate(endRaw) : undefined;

      if (start && end) {
        const duration = Math.max(
          end.at - start.at,
          start.allDay ? 86_400_000 : 30 * 60_000,
        );
        for (const slot of expand(
          start.at,
          start.at + duration,
          current.RRULE,
          from,
          to,
        )) {
          events.push({
            id: `${source.id}:${current.UID ?? randomUUID()}:${slot.start}`,
            title: (current.SUMMARY ?? "(bez nazwy)")
              .replace(/\\,/g, ",")
              .replace(/\\n/g, " "),
            start: slot.start,
            end: slot.end,
            allDay: start.allDay,
            source: source.name,
            color: source.color,
            location: current.LOCATION?.replace(/\\,/g, ","),
          });
        }
      }
      current = undefined;
      continue;
    }
    if (!current) continue;

    const sep = line.indexOf(":");
    if (sep === -1) continue;
    // Nazwa pola bywa z parametrami, na przykład DTSTART;TZID=Europe/Warsaw.
    const key = line.slice(0, sep).split(";")[0].toUpperCase();
    current[key] = line.slice(sep + 1);
  }

  return events;
}

/* ------------------------------------------------------------------ */
/* Źródła i bloki                                                      */
/* ------------------------------------------------------------------ */

export async function listSources(): Promise<CalendarSource[]> {
  return (await read()).sources;
}

export async function saveSource(
  input: Partial<CalendarSource>,
): Promise<CalendarSource[]> {
  const store = await read();
  if (!input.url?.trim()) throw new Error("Podaj adres ICS");

  const existing = store.sources.find((s) => s.id === input.id);
  if (existing) {
    Object.assign(existing, input);
  } else {
    store.sources.push({
      id: randomUUID(),
      name: input.name?.trim() || "Kalendarz",
      url: input.url.trim(),
      color: input.color ?? "#6366f1",
      enabled: input.enabled ?? true,
    });
  }
  await write(store);
  return store.sources;
}

export async function deleteSource(id: string): Promise<CalendarSource[]> {
  const store = await read();
  store.sources = store.sources.filter((s) => s.id !== id);
  await write(store);
  return store.sources;
}

type CacheEntry = { at: number; events: CalendarEvent[] };
const cacheRef = globalThis as unknown as {
  __csmIcs?: Map<string, CacheEntry>;
};
const cache: Map<string, CacheEntry> = (cacheRef.__csmIcs ??= new Map());

/** Kalendarze zmieniają się wolno, a pobieranie idzie przez sieć. */
const TTL_MS = 5 * 60_000;

async function fetchSource(
  source: CalendarSource,
  from: number,
  to: number,
): Promise<CalendarEvent[]> {
  const key = `${source.id}:${from}:${to}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.events;

  try {
    const res = await fetch(source.url, {
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error(`serwer odpowiedział ${res.status}`);
    const events = parseIcs(await res.text(), source, from, to);
    cache.set(key, { at: Date.now(), events });

    const store = await read();
    const entry = store.sources.find((s) => s.id === source.id);
    if (entry) {
      entry.lastSync = Date.now();
      entry.lastError = undefined;
      await write(store);
    }
    return events;
  } catch (e) {
    const store = await read();
    const entry = store.sources.find((s) => s.id === source.id);
    if (entry) {
      entry.lastError = e instanceof Error ? e.message : String(e);
      await write(store);
    }
    return [];
  }
}

export async function listEvents(
  from: number,
  to: number,
): Promise<CalendarEvent[]> {
  const store = await read();
  const remote = await Promise.all(
    store.sources.filter((s) => s.enabled).map((s) => fetchSource(s, from, to)),
  );
  const own = store.blocks.filter((b) => b.start < to && b.end > from);
  return [...remote.flat(), ...own].sort((a, b) => a.start - b.start);
}

export async function addBlock(input: {
  title: string;
  start: number;
  end: number;
  taskId?: string;
}): Promise<CalendarEvent> {
  const store = await read();
  const block: CalendarEvent & { own: true } = {
    id: randomUUID(),
    title: input.title,
    start: input.start,
    end: input.end,
    allDay: false,
    source: "Fluxdesk",
    color: "#8b5cf6",
    own: true,
    taskId: input.taskId,
    remote: {},
  };
  store.blocks.push(block);
  await write(store);
  void syncBlock(block.id);
  return block;
}

/**
 * Wysyła blok do podłączonych kalendarzy i zapamiętuje identyfikatory zwrotne.
 * Robimy to w tle: planowanie dnia nie ma czekać na sieć.
 */
export async function syncBlock(id: string): Promise<void> {
  try {
    const { pushBlock } = await import("./calendar-sync");
    const store = await read();
    const block = store.blocks.find((b) => b.id === id);
    if (!block) return;

    for (const provider of ["google", "microsoft"] as const) {
      const remoteId = await pushBlock(provider, {
        title: block.title,
        start: block.start,
        end: block.end,
        taskId: block.taskId,
        remoteId: block.remote?.[provider],
      });
      if (remoteId) {
        block.remote = { ...block.remote, [provider]: remoteId };
      }
    }
    await write(store);
  } catch {
    /* brak podłączonych kont albo chwilowy brak sieci */
  }
}

export async function moveBlock(
  id: string,
  start: number,
  end: number,
): Promise<void> {
  const store = await read();
  const block = store.blocks.find((b) => b.id === id);
  if (!block) throw new Error("Nie ma takiego bloku");
  block.start = start;
  block.end = end;
  await write(store);
  void syncBlock(id);
}

export async function deleteBlock(id: string): Promise<void> {
  const store = await read();
  const block = store.blocks.find((b) => b.id === id);

  // Usunięcie bloku musi zabrać też jego odpowiedniki po drugiej stronie.
  if (block?.remote) {
    try {
      const { deleteRemote } = await import("./calendar-sync");
      for (const provider of ["google", "microsoft"] as const) {
        const remoteId = block.remote[provider];
        if (remoteId) await deleteRemote(provider, remoteId);
      }
    } catch {
      /* konto odłączone; lokalnie i tak kasujemy */
    }
  }

  store.blocks = store.blocks.filter((b) => b.id !== id);
  await write(store);
}

/** Własne bloki jako ICS, do zasubskrybowania w Google albo Outlooku. */
export async function exportIcs(): Promise<string> {
  const store = await read();
  const stamp = (ms: number) =>
    new Date(ms)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Fluxdesk//PL",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Fluxdesk",
  ];
  for (const b of store.blocks) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${b.id}@fluxdesk`,
      `DTSTAMP:${stamp(Date.now())}`,
      `DTSTART:${stamp(b.start)}`,
      `DTEND:${stamp(b.end)}`,
      `SUMMARY:${b.title.replace(/,/g, "\\,")}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
