import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { dataDir } from "./store";

const run = promisify(execFile);

/**
 * Zadania Fluxdesk. Przepływ jest jawny: zadanie idzie od „do zrobienia” przez
 * pracę, ewentualną poprawkę, do stanów po robocie (testowanie, feedback),
 * a zamyka się dopiero jako „zrobione”. Dzięki temu widać różnicę między
 * „już nie pracuję” a „można o tym zapomnieć”.
 */

export const STATUSES = [
  "to_do",
  "in_progress",
  "do_poprawy",
  "zlecone",
  "testowanie",
  "feedback",
  "zrobione",
] as const;

export type TaskStatus = (typeof STATUSES)[number];

/** Robota skończona, ale zadanie jeszcze żyje: czeka na test albo na opinię. */
export const COMPLETED: TaskStatus[] = ["testowanie", "feedback"];

/** Jedyny stan zamknięty. */
export const CLOSED: TaskStatus[] = ["zrobione"];

/** Zadania, przy których praca wciąż trwa albo dopiero się zacznie. */
export const OPEN: TaskStatus[] = [
  "to_do",
  "in_progress",
  "do_poprawy",
  "zlecone",
];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  to_do: "do zrobienia",
  in_progress: "w trakcie",
  do_poprawy: "do poprawy",
  zlecone: "zlecone",
  testowanie: "testowanie",
  feedback: "feedback",
  zrobione: "zrobione",
};

export type Task = {
  id: string;
  title: string;
  notes?: string;
  project?: string;
  tags: string[];
  status: TaskStatus;
  /** 0 zwykłe, 1 ważne, 2 pilne. */
  priority: 0 | 1 | 2;
  due?: string;
  /** Komu zlecone, gdy zadanie wyszło poza Ciebie. */
  assignedTo?: string;
  createdAt: number;
  updatedAt: number;
  /** Kiedy praca została skończona, czyli wejście w testowanie albo feedback. */
  completedAt?: number;
  /** Kiedy zadanie zostało zamknięte. */
  closedAt?: number;
  /** Sesje, w których nad tym pracowano. */
  sessionIds: string[];
  timeSpentMs: number;
  startedAt?: number;
  /** Identyfikator z taskwarriora, gdy zadanie pochodzi z migracji. */
  importedFrom?: string;
  /** Zadanie nadrzędne; podzadania dziedziczą po nim projekt i tagi. */
  parentId?: string;
  /** Zadania, bez których tego nie da się zacząć. */
  blockedBy?: string[];
  /** Powtarzalność: co ile dni zadanie wraca po zamknięciu. */
  repeatDays?: number;
  /** Szacowany czas w minutach, do porównania z rzeczywistym. */
  estimateMin?: number;
  /** Ile czasu zadanie spędziło w każdym statusie. */
  statusTime?: Partial<Record<TaskStatus, number>>;
  /** Kiedy weszło w bieżący status; stąd liczymy powyższe. */
  statusSince?: number;
};

type Store = { version: 2; tasks: Task[] };

function file(): string {
  return path.join(dataDir(), "tasks.json");
}

/** Statusy z pierwszej wersji modelu, zamieniane przy pierwszym odczycie. */
const LEGACY: Record<string, TaskStatus> = {
  inbox: "to_do",
  next: "to_do",
  doing: "in_progress",
  done: "zrobione",
};

function migrate(task: Task & { status: string }): Task {
  const status = (STATUSES as readonly string[]).includes(task.status)
    ? (task.status as TaskStatus)
    : (LEGACY[task.status] ?? "to_do");

  return {
    ...task,
    status,
    tags: task.tags ?? [],
    closedAt:
      status === "zrobione" ? (task.closedAt ?? task.completedAt) : undefined,
  };
}

async function read(): Promise<Store> {
  try {
    const raw = JSON.parse(await fs.readFile(file(), "utf8")) as {
      version: number;
      tasks: (Task & { status: string; doneAt?: number })[];
    };
    return {
      version: 2,
      tasks: raw.tasks.map((t) =>
        migrate({
          ...t,
          closedAt: t.closedAt ?? t.doneAt,
          completedAt: t.completedAt ?? t.doneAt,
        }),
      ),
    };
  } catch {
    return { version: 2, tasks: [] };
  }
}

async function write(store: Store): Promise<void> {
  await fs.mkdir(path.dirname(file()), { recursive: true });
  await fs.writeFile(file(), JSON.stringify(store, null, 2), "utf8");
}

/** Pilne i przeterminowane na górę, praca w toku przed tym, co jeszcze nie ruszyło. */
function rank(t: Task): number {
  let score = t.priority * 100;
  if (t.status === "in_progress") score += 500;
  if (t.status === "do_poprawy") score += 300;
  if (t.status === "to_do") score += 60;
  if (t.status === "zlecone") score += 40;
  if (t.due) {
    const days = (new Date(t.due).getTime() - Date.now()) / 86_400_000;
    if (days < 0) score += 400;
    else if (days < 1) score += 250;
    else if (days < 3) score += 120;
    else if (days < 7) score += 50;
  }
  return score;
}

export type TaskFilter = {
  status?: TaskStatus;
  /** Skróty zbiorcze: otwarte, po robocie, zamknięte. */
  group?: "open" | "completed" | "closed" | "all";
  project?: string;
  tag?: string;
  q?: string;
};

export async function listTasks(filter: TaskFilter = {}): Promise<Task[]> {
  const { tasks } = await read();
  const needle = filter.q?.trim().toLowerCase();

  return tasks
    .filter((t) => {
      if (filter.status) return t.status === filter.status;
      if (filter.group === "completed") return COMPLETED.includes(t.status);
      if (filter.group === "closed") return CLOSED.includes(t.status);
      if (filter.group === "all") return true;
      return OPEN.includes(t.status);
    })
    .filter((t) => (filter.project ? t.project === filter.project : true))
    .filter((t) => (filter.tag ? t.tags.includes(filter.tag) : true))
    .filter((t) =>
      needle
        ? `${t.title} ${t.notes ?? ""} ${t.project ?? ""} ${t.tags.join(" ")}`
            .toLowerCase()
            .includes(needle)
        : true,
    )
    .sort((a, b) => rank(b) - rank(a) || b.updatedAt - a.updatedAt);
}

/** Wszystkie użyte etykiety wraz z liczbą zadań — do podpowiedzi i filtrów. */
export async function listTags(): Promise<{ tag: string; count: number }[]> {
  const { tasks } = await read();
  const counts = new Map<string, number>();
  for (const t of tasks) {
    if (CLOSED.includes(t.status)) continue;
    for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

export async function createTask(
  input: Partial<Task> & { title: string },
): Promise<Task> {
  const store = await read();
  const now = Date.now();
  const task: Task = {
    id: randomUUID(),
    title: input.title.trim(),
    notes: input.notes,
    project: input.project,
    tags: input.tags ?? [],
    status: input.status ?? "to_do",
    priority: input.priority ?? 0,
    due: input.due,
    assignedTo: input.assignedTo,
    createdAt: now,
    updatedAt: now,
    sessionIds: [],
    timeSpentMs: 0,
    importedFrom: input.importedFrom,
    parentId: input.parentId,
    blockedBy: input.blockedBy,
    repeatDays: input.repeatDays,
    estimateMin: input.estimateMin,
    statusSince: now,
    statusTime: {},
  };
  store.tasks.push(task);
  await write(store);
  return task;
}

/** Zmiana statusu pilnuje zegara i znaczników czasu, żeby nie trzeba było o tym pamiętać. */
function applyStatus(task: Task, status: TaskStatus): void {
  const now = Date.now();

  // Czas w poprzednim statusie: stąd wiadomo, gdzie praca naprawdę stoi.
  const previous = task.status;
  if (task.statusSince) {
    task.statusTime = task.statusTime ?? {};
    task.statusTime[previous] = (task.statusTime[previous] ?? 0) + (now - task.statusSince);
  }
  task.statusSince = now;
  task.status = status;

  if (status === "in_progress") {
    task.completedAt = undefined;
    task.closedAt = undefined;
    return;
  }

  // Wyjście z pracy zatrzymuje zegar, inaczej czas rósłby bez końca.
  if (task.startedAt) {
    task.timeSpentMs += now - task.startedAt;
    task.startedAt = undefined;
  }

  if (COMPLETED.includes(status)) {
    task.completedAt = task.completedAt ?? now;
    task.closedAt = undefined;
  } else if (status === "zrobione") {
    task.completedAt = task.completedAt ?? now;
    task.closedAt = now;
  } else {
    task.completedAt = undefined;
    task.closedAt = undefined;
  }
}

export async function updateTask(
  id: string,
  patch: Partial<Task>,
): Promise<Task> {
  const store = await read();
  const task = store.tasks.find((t) => t.id === id);
  if (!task) throw new Error("Nie ma takiego zadania");

  const { status, ...rest } = patch;
  Object.assign(task, rest, { id: task.id, updatedAt: Date.now() });
  if (status && status !== task.status) {
    applyStatus(task, status);
    await respawnIfRepeating(store, task);
  }

  await write(store);
  return task;
}

/**
 * Zamknięcie zadania cyklicznego zakłada kolejne wystąpienie. Faktury i ZUS
 * wracają co miesiąc niezależnie od tego, czy ktoś o nich pamięta.
 */
async function respawnIfRepeating(store: Store, task: Task): Promise<void> {
  if (!task.repeatDays || task.status !== "zrobione") return;
  const now = Date.now();
  store.tasks.push({
    ...task,
    id: randomUUID(),
    status: "to_do",
    createdAt: now,
    updatedAt: now,
    completedAt: undefined,
    closedAt: undefined,
    statusSince: now,
    statusTime: {},
    timeSpentMs: 0,
    startedAt: undefined,
    sessionIds: [],
    due: new Date(now + task.repeatDays * 86_400_000).toISOString(),
  });
}

/** Podzadania danego zadania, w kolejności utworzenia. */
export async function subtasks(parentId: string): Promise<Task[]> {
  const { tasks } = await read();
  return tasks.filter((t) => t.parentId === parentId).sort((a, b) => a.createdAt - b.createdAt);
}

/** Czy zadanie czeka na inne, jeszcze niezamknięte. */
export async function blockers(id: string): Promise<Task[]> {
  const { tasks } = await read();
  const task = tasks.find((t) => t.id === id);
  if (!task?.blockedBy?.length) return [];
  return tasks.filter((t) => task.blockedBy!.includes(t.id) && !CLOSED.includes(t.status));
}

export async function deleteTask(id: string): Promise<void> {
  const store = await read();
  store.tasks = store.tasks.filter((t) => t.id !== id);
  await write(store);
}

/** Start i stop zegara; jednocześnie może biec tylko jedno zadanie. */
export async function toggleTimer(id: string): Promise<Task> {
  const store = await read();
  const task = store.tasks.find((t) => t.id === id);
  if (!task) throw new Error("Nie ma takiego zadania");

  if (task.startedAt) {
    task.timeSpentMs += Date.now() - task.startedAt;
    task.startedAt = undefined;
  } else {
    for (const other of store.tasks) {
      if (other.startedAt) {
        other.timeSpentMs += Date.now() - other.startedAt;
        other.startedAt = undefined;
        other.updatedAt = Date.now();
      }
    }
    task.startedAt = Date.now();
    task.status = "in_progress";
    task.completedAt = undefined;
    task.closedAt = undefined;
  }
  task.updatedAt = Date.now();
  await write(store);
  return task;
}

/** Wiąże zadanie z sesją, żeby dziennik wiedział, na co poszedł czas. */
export async function linkSession(
  id: string,
  sessionId: string,
): Promise<Task> {
  const store = await read();
  const task = store.tasks.find((t) => t.id === id);
  if (!task) throw new Error("Nie ma takiego zadania");
  if (!task.sessionIds.includes(sessionId)) task.sessionIds.push(sessionId);
  task.updatedAt = Date.now();
  await write(store);
  return task;
}

/**
 * Zadania wysłane do sesji jako kolejka: panel podaje kolejne, gdy poprzednie
 * się skończy. Dzięki temu można zostawić kilka rzeczy do zrobienia i odejść.
 */
export async function queueForSession(sessionId: string, ids: string[]): Promise<Task[]> {
  const store = await read()
  const queued: Task[] = []
  for (const id of ids) {
    const task = store.tasks.find((t) => t.id === id)
    if (!task) continue
    if (!task.sessionIds.includes(sessionId)) task.sessionIds.push(sessionId)
    task.updatedAt = Date.now()
    queued.push(task)
  }
  await write(store)
  return queued
}

/** Gotowe zestawy kroków; te same rzeczy robi się zwykle tak samo. */
export const TEMPLATES: Record<string, { title: string; steps: string[]; tags: string[] }> = {
  artykul: {
    title: 'Nowy artykuł na bloga',
    steps: [
      'Wybrać temat i słowo kluczowe',
      'Napisać szkic',
      'Dobrać zdjęcie',
      'Sprawdzić pozycjonowanie i linkowanie',
      'Opublikować i sprawdzić na stronie',
    ],
    tags: ['carmore', 'blog'],
  },
  wdrozenie: {
    title: 'Wdrożenie u klienta',
    steps: [
      'Rozmowa wstępna i mapa procesu',
      'Wycena i zakres',
      'Budowa automatyzacji',
      'Testy z klientem',
      'Przekazanie i dokumentacja',
    ],
    tags: ['fluxlab'],
  },
  raport: {
    title: 'Raport miesięczny',
    steps: ['Zebrać dane', 'Sprawdzić anomalie', 'Opisać wnioski', 'Wysłać'],
    tags: ['carmore', 'raporty'],
  },
}

/** Rozwija szablon w zadanie z podzadaniami. */
export async function createFromTemplate(key: string, project?: string): Promise<Task> {
  const template = TEMPLATES[key]
  if (!template) throw new Error('Nie ma takiego szablonu')

  const parent = await createTask({
    title: template.title,
    tags: template.tags,
    project,
    status: 'to_do',
  })
  for (const step of template.steps) {
    await createTask({
      title: step,
      tags: template.tags,
      project,
      status: 'to_do',
      parentId: parent.id,
    })
  }
  return parent
}

/**
 * Zadania wymagające uwagi: zlecone bez ruchu, przeterminowane oraz te,
 * które od dawna wiszą w trakcie. To one zwykle cicho gniją.
 */
export async function needsAttention(): Promise<{
  staleAssigned: Task[]
  overdue: Task[]
  stalled: Task[]
  ancient: Task[]
}> {
  const { tasks } = await read()
  const now = Date.now()
  const open = tasks.filter((t) => OPEN.includes(t.status))

  return {
    staleAssigned: open.filter(
      (t) => t.status === 'zlecone' && now - t.updatedAt > 7 * 86_400_000
    ),
    overdue: open.filter((t) => t.due && new Date(t.due).getTime() < now),
    stalled: open.filter(
      (t) => t.status === 'in_progress' && now - t.updatedAt > 5 * 86_400_000
    ),
    // Zadania sprzed roku zwykle nie są już aktualne, tylko nikt ich nie zamknął.
    ancient: open.filter((t) => now - t.createdAt > 365 * 86_400_000).slice(0, 50),
  }
}

export async function activeTask(): Promise<Task | undefined> {
  const { tasks } = await read();
  return tasks.find((t) => t.startedAt);
}

/* ------------------------------------------------------------------ */
/* Migracja z taskwarriora                                             */
/* ------------------------------------------------------------------ */

type TwTask = {
  uuid: string;
  description: string;
  project?: string;
  tags?: string[];
  status: string;
  due?: string;
  entry?: string;
  end?: string;
  priority?: string;
  annotations?: { description: string }[];
};

function twDate(value?: string): string | undefined {
  if (!value) return undefined;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : value;
}

export async function importFromTaskwarrior(): Promise<{
  imported: number;
  skipped: number;
}> {
  let raw: TwTask[];
  try {
    const { stdout } = await run(
      "task",
      ["rc.confirmation=off", "rc.hooks=off", "export"],
      {
        timeout: 20_000,
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    raw = JSON.parse(stdout || "[]") as TwTask[];
  } catch {
    throw new Error("Nie udało się odczytać taskwarriora");
  }

  const store = await read();
  const known = new Set(store.tasks.map((t) => t.importedFrom).filter(Boolean));
  let imported = 0;
  let skipped = 0;

  for (const t of raw) {
    if (known.has(t.uuid)) {
      skipped++;
      continue;
    }
    const now = Date.now();
    const closed = t.status === "completed";
    store.tasks.push({
      id: randomUUID(),
      title: t.description,
      notes: t.annotations?.map((a) => a.description).join("\n") || undefined,
      project: t.project,
      tags: t.tags ?? [],
      status: closed ? "zrobione" : "to_do",
      priority: t.priority === "H" ? 2 : t.priority === "M" ? 1 : 0,
      due: twDate(t.due),
      createdAt: t.entry ? new Date(twDate(t.entry)!).getTime() : now,
      updatedAt: now,
      completedAt: t.end ? new Date(twDate(t.end)!).getTime() : undefined,
      closedAt:
        closed && t.end ? new Date(twDate(t.end)!).getTime() : undefined,
      sessionIds: [],
      timeSpentMs: 0,
      importedFrom: t.uuid,
    });
    imported++;
  }

  await write(store);
  return { imported, skipped };
}
