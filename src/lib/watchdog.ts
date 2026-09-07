import { connectTerminal, listTerminals } from "./terminals";
import { readTermStatus, type TermStatus } from "./termstate";
import { notify } from "./notify";
import { listTasks, updateTask } from "./todo";
import { startTerminal } from "./terminals";
import { readSchedule, writeSchedule } from "./schedule";

/**
 * Dozorca sesji. Pilnuje dwóch rzeczy, których nie widać, dopóki nie zajrzy się
 * do okna: pytań, które blokują rozmowę w nieskończoność, oraz pracy, która
 * kręci się w kółko. Jedno i drugie potrafi kosztować godziny ciszy.
 */

/** Po tylu milisekundach tej samej czynności uznajemy, że sesja utknęła. */
const STUCK_AFTER_MS = 12 * 60_000;

/** Jak długo pytanie może czekać, zanim odpowiemy na nie sami. */
const AUTO_ANSWER_AFTER_MS = 20_000;

type Watch = {
  /** Czynność i moment, w którym się zaczęła — stąd wiadomo, czy coś stoi. */
  activity?: string;
  since: number;
  stuckReported?: boolean;
  /** Pytanie o sposób wznowienia, na które już odpowiedzieliśmy. */
  answered?: boolean;
  seenQuestionAt?: number;
};

type State = {
  watches: Map<string, Watch>;
  timer?: ReturnType<typeof setInterval>;
};
const ref = globalThis as unknown as { __csmWatchdog?: State };
const state: State = (ref.__csmWatchdog ??= { watches: new Map() });

async function readScreen(id: string): Promise<TermStatus | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), 1500);
    connectTerminal(id, (msg) => {
      if (msg.t !== "snapshot") return;
      clearTimeout(timer);
      resolve(readTermStatus(msg.d));
    })
      .then((conn) => setTimeout(() => conn.close(), 1600))
      .catch(() => {
        clearTimeout(timer);
        resolve(undefined);
      });
  });
}

async function send(id: string, data: string): Promise<void> {
  try {
    const conn = await connectTerminal(id, () => undefined);
    conn.send({ t: "input", d: data });
    setTimeout(() => conn.close(), 100);
  } catch {
    /* gospodarz zniknął */
  }
}

/**
 * Pytanie o sposób wznowienia zawsze ma tę samą odpowiedź: streszczenie.
 * Pełne wznowienie długiej rozmowy potrafi zjeść dużą część limitu, a sesja
 * i tak stoi, dopóki ktoś nie kliknie.
 */
function isResumePrompt(status: TermStatus): boolean {
  return (
    status.state === "waiting" && /jak wznowić/i.test(status.question ?? "")
  );
}

/**
 * Zaplanowane sesje. Odpalamy je raz w oknie danej minuty, a `lastRun` pilnuje,
 * żeby nie ruszyć tego samego wpisu dwa razy przy kolejnym przebiegu.
 */
async function runSchedule(): Promise<void> {
  let items
  try {
    items = await readSchedule()
  } catch {
    return
  }

  const now = new Date()
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
  const weekday = now.getDay() === 0 ? 7 : now.getDay()

  for (const item of items) {
    if (!item.enabled || item.at !== hhmm) continue
    if (item.days.length && !item.days.includes(weekday)) continue
    if (item.lastRun && Date.now() - item.lastRun < 120_000) continue

    try {
      const term = await startTerminal({
        cwd: item.cwd,
        title: item.prompt.slice(0, 40),
        model: item.model,
        permissionMode: "bypassPermissions",
      })
      // Prompt trafia do świeżo uruchomionego terminala po chwili na rozruch.
      setTimeout(() => void send(term.id, `${item.prompt}\r`), 4000)
      item.lastRun = Date.now()
      await writeSchedule(items)
    } catch {
      /* katalog mógł zniknąć */
    }
  }
}

/**
 * Zajętość z subskrybowanych kalendarzy przenosimy na konta co kwadrans.
 * Rzadziej niż reszta pętli, bo to ruch po sieci, a terminy nie zmieniają się
 * z sekundy na sekundę.
 */
let lastMirror = 0

async function mirrorTick(): Promise<void> {
  if (Date.now() - lastMirror < 15 * 60_000) return
  lastMirror = Date.now()
  try {
    const { mirrorBusy } = await import('./calendar-mirror')
    await mirrorBusy({ days: 14 })
  } catch {
    /* brak połączonych kont albo chwilowy brak sieci */
  }
}

async function tick(): Promise<void> {
  await runSchedule()
  void mirrorTick()

  let terminals;
  try {
    terminals = await listTerminals();
  } catch {
    return;
  }

  const alive = new Set(terminals.filter((t) => t.alive).map((t) => t.id));
  for (const id of state.watches.keys()) {
    if (!alive.has(id)) state.watches.delete(id);
  }

  for (const term of terminals) {
    if (!term.alive) continue;
    const status = await readScreen(term.id);
    if (!status) continue;

    const watch = state.watches.get(term.id) ?? { since: Date.now() };

    if (isResumePrompt(status)) {
      watch.seenQuestionAt ??= Date.now();
      // Chwila zwłoki, żeby nie wyprzedzić użytkownika, który właśnie patrzy.
      if (
        !watch.answered &&
        Date.now() - watch.seenQuestionAt > AUTO_ANSWER_AFTER_MS
      ) {
        await send(term.id, "1\r");
        watch.answered = true;
      }
      state.watches.set(term.id, watch);
      continue;
    }
    watch.seenQuestionAt = undefined;
    watch.answered = false;

    if (status.state === "working") {
      if (status.activity !== watch.activity) {
        watch.activity = status.activity;
        watch.since = Date.now();
        watch.stuckReported = false;
      } else if (
        !watch.stuckReported &&
        Date.now() - watch.since > STUCK_AFTER_MS
      ) {
        watch.stuckReported = true;
        const minutes = Math.round((Date.now() - watch.since) / 60_000);
        void notify({
          title: `${term.title}: chyba utknęła`,
          message: `${status.activity ?? "ta sama czynność"} od ${minutes} minut`,
          priority: 3,
          tags: ["hourglass"],
        });
      }
    } else {
      // Przejście z pracy w gotowość to moment na kolejne zadanie z kolejki.
      if (watch.activity && status.state === "idle" && term.sessionId) {
        await feedQueue(term.sessionId, term.id);
      }
      watch.activity = undefined;
      watch.since = Date.now();
      watch.stuckReported = false;
    }

    state.watches.set(term.id, watch);
  }
}

/**
 * Kolejka zadań: gdy sesja skończy pracę, dostaje następne zadanie przypisane
 * do niej. Dzięki temu można zostawić kilka rzeczy do zrobienia i odejść.
 */
async function feedQueue(sessionId: string, terminalId: string): Promise<boolean> {
  const tasks = await listTasks({ group: 'open' })
  const next = tasks.find((t) => t.sessionIds.includes(sessionId) && t.status === 'to_do')
  if (!next) return false

  await updateTask(next.id, { status: 'in_progress' })
  await send(terminalId, `${next.title}${next.notes ? `\n\n${next.notes}` : ''}\r`)
  return true
}

/** Czy sesja stoi w miejscu, wraz z czasem trwania tej samej czynności. */
export function stuckInfo(
  id: string,
): { stuck: boolean; sinceMs: number } | undefined {
  const watch = state.watches.get(id);
  if (!watch?.activity) return undefined;
  const sinceMs = Date.now() - watch.since;
  return { stuck: sinceMs > STUCK_AFTER_MS, sinceMs };
}

export function startWatchdog(): void {
  if (state.timer) return;
  state.timer = setInterval(() => void tick(), 15_000);
  void tick();
}
