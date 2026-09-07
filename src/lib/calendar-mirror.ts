import { promises as fs } from "node:fs";
import path from "node:path";

import { listEvents } from "./calendar";
import { listAccounts, type AccountId } from "./calendar-oauth";
import { dataDir } from "./store";

/**
 * Zasłona zajętości między kalendarzami. Wydarzenie z jednego kalendarza
 * pojawia się w drugim jako sam blok czasu, bez nazwy i bez szczegółów:
 * współpracownicy widzą, że termin jest zajęty, ale nie wiedzą czym.
 *
 * Świadomie kopiujemy tylko godziny. Tytuł jest stały, opisu nie ma, więc
 * z odbicia nie da się odczytać, co to za sprawa.
 */

const TITLE = "Zajęte";

type Mirror = {
  /** Klucz źródłowego wydarzenia: skąd i kiedy. */
  key: string;
  /** Konto, na którym powstało odbicie. */
  account: AccountId;
  remoteId: string;
  start: number;
  end: number;
};

type MirrorStore = { version: 1; items: Mirror[] };

function file(): string {
  return path.join(dataDir(), "calendar-mirror.json");
}

async function read(): Promise<MirrorStore> {
  try {
    return JSON.parse(await fs.readFile(file(), "utf8")) as MirrorStore;
  } catch {
    return { version: 1, items: [] };
  }
}

async function write(store: MirrorStore): Promise<void> {
  await fs.writeFile(file(), JSON.stringify(store, null, 2));
}

export type MirrorResult = {
  created: number;
  updated: number;
  removed: number;
  skipped: number;
};

/**
 * Przenosi zajętość ze źródeł ICS na wskazane konta. Domyślnie patrzy dwa
 * tygodnie do przodu; dalsze terminy i tak zwykle się jeszcze przesuwają.
 */
export async function mirrorBusy(
  options: {
    from?: number;
    days?: number;
    /** Konta docelowe; domyślnie wszystkie połączone. */
    accounts?: AccountId[];
    /** Nazwy źródeł do odbicia; domyślnie wszystkie subskrypcje ICS. */
    sources?: string[];
  } = {},
): Promise<MirrorResult> {
  const from = options.from ?? Date.now();
  const to = from + (options.days ?? 14) * 86_400_000;

  const targets = (await listAccounts())
    .filter((a) => a.connected)
    .map((a) => a.id)
    .filter((id) => !options.accounts || options.accounts.includes(id));

  const result: MirrorResult = {
    created: 0,
    updated: 0,
    removed: 0,
    skipped: 0,
  };
  if (!targets.length) return result;

  const events = (await listEvents(from, to)).filter((e) => {
    // Odbijamy tylko subskrypcje ICS: własne bloki i tak lecą na konta,
    // a wydarzeń z konta nie ma sensu kopiować samych na siebie.
    if (e.allDay) return false;
    const isSubscription = !("own" in e) && !("account" in e);
    if (!isSubscription) return false;
    if (options.sources && !options.sources.includes(e.source)) return false;
    return true;
  });

  const store = await read();
  const { pushBlock, deleteRemote } = await import("./calendar-sync");
  const seen = new Set<string>();

  for (const event of events) {
    for (const account of targets) {
      const key = `${event.source}|${event.id}`;
      seen.add(`${key}|${account}`);

      const existing = store.items.find(
        (m) => m.key === key && m.account === account,
      );
      if (
        existing &&
        existing.start === event.start &&
        existing.end === event.end
      ) {
        result.skipped++;
        continue;
      }

      const remoteId = await pushBlock(account, {
        title: TITLE,
        start: event.start,
        end: event.end,
        remoteId: existing?.remoteId,
      });
      if (!remoteId) continue;

      if (existing) {
        existing.remoteId = remoteId;
        existing.start = event.start;
        existing.end = event.end;
        result.updated++;
      } else {
        store.items.push({
          key,
          account,
          remoteId,
          start: event.start,
          end: event.end,
        });
        result.created++;
      }
    }
  }

  // Odwołane wydarzenie musi zabrać ze sobą swoje odbicie, inaczej zostałby
  // pusty blok blokujący wolny termin.
  const stale = store.items.filter(
    (m) =>
      m.start >= from && m.start < to && !seen.has(`${m.key}|${m.account}`),
  );
  for (const m of stale) {
    await deleteRemote(m.account, m.remoteId).catch(() => undefined);
    result.removed++;
  }
  store.items = store.items.filter((m) => !stale.includes(m));

  await write(store);
  return result;
}

/**
 * Identyfikatory odbić po stronie kont. Widok panelu je pomija: dla Ciebie
 * liczy się prawdziwe wydarzenie, a „Zajęte" istnieje wyłącznie dla osób
 * zaglądających w Twój kalendarz.
 */
export async function mirroredRemoteIds(): Promise<Set<string>> {
  const store = await read();
  return new Set(store.items.map((m) => m.remoteId));
}
