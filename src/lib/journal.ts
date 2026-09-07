import path from "node:path";

import { listLiveSessions } from "./runner";
import { listTasks } from "./todo";
import { scanAllSessions, totalTokens } from "./transcript";

/**
 * Dziennik dnia: co się działo, w jakich projektach i ile to zajęło.
 * Dane pochodzą z transkryptów i z zadań panelu, więc powstają same,
 * bez proszenia o wypełnianie czegokolwiek.
 */

export type JournalEntry = {
  sessionId: string;
  title: string;
  project: string;
  cwd?: string;
  firstSeen: number;
  lastSeen: number;
  messageCount: number;
  tokens: number;
  costUsd: number;
  /** Czas tur zmierzony przez panel; dostępny tylko dla sesji z panelu. */
  activeMs?: number;
};

/** Kurs do przeliczeń; wystarczy przybliżenie, chodzi o rząd wielkości. */
export const USD_PLN = Number(process.env.CSM_USD_PLN ?? 4.0);

export type JournalDay = {
  date: string;
  entries: JournalEntry[];
  byProject: {
    project: string;
    sessions: number;
    tokens: number;
    costUsd: number;
  }[];
  doneTasks: {
    description: string;
    project?: string;
    end?: string;
    timeSpentMs?: number;
  }[];
  totals: {
    sessions: number;
    tokens: number;
    costUsd: number;
    activeMs: number;
  };
  /** Najdroższe rozmowy dnia; zwykle jedna zjada większość budżetu. */
  topCost: JournalEntry[];
  /** Kurs użyty do przeliczeń, żeby interfejs nie musiał go zgadywać. */
  usdPln: number;
};

function dayBounds(date: string): { from: number; to: number } {
  const start = new Date(`${date}T00:00:00`);
  return { from: start.getTime(), to: start.getTime() + 86_400_000 };
}

/** Zadania zamknięte danego dnia — druga połowa obrazu obok sesji. */
async function completedTasks(date: string) {
  const { from, to } = dayBounds(date);
  const tasks = await listTasks({ group: "closed" });
  return tasks
    .filter((t) => t.closedAt && t.closedAt >= from && t.closedAt < to)
    .map((t) => ({
      description: t.title,
      project: t.project,
      end: t.closedAt ? new Date(t.closedAt).toISOString() : undefined,
      timeSpentMs: t.timeSpentMs,
    }));
}

/**
 * Podsumowanie tygodnia: te same liczby co dzienne, ale zebrane po dniach.
 * Widać z tego, czy tempo rośnie i gdzie faktycznie idzie praca.
 */
/**
 * Rozliczenie czasu i kosztu na projekt w zadanym okresie. To jest podstawa
 * pod fakturę i pod odpowiedź na pytanie, ile realnie kosztuje dany klient.
 */
export async function buildBilling(days = 30): Promise<{
  from: string
  to: string
  rows: { project: string; sessions: number; tokens: number; costUsd: number; taskMin: number }[]
  usdPln: number
}> {
  const rows = new Map<string, { sessions: number; tokens: number; costUsd: number; taskMin: number }>()

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)
    const day = await buildJournal(date)
    for (const p of day.byProject) {
      const acc = rows.get(p.project) ?? { sessions: 0, tokens: 0, costUsd: 0, taskMin: 0 }
      acc.sessions += p.sessions
      acc.tokens += p.tokens
      acc.costUsd += p.costUsd
      rows.set(p.project, acc)
    }
  }

  // Czas zmierzony zegarem zadań doliczamy osobno: to jedyna miara ludzkiej pracy.
  const tasks = await listTasks({ group: 'all' })
  for (const t of tasks) {
    if (!t.project || !t.timeSpentMs) continue
    const acc = rows.get(t.project) ?? { sessions: 0, tokens: 0, costUsd: 0, taskMin: 0 }
    acc.taskMin += Math.round(t.timeSpentMs / 60_000)
    rows.set(t.project, acc)
  }

  return {
    from: new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
    rows: [...rows.entries()]
      .map(([project, v]) => ({ project, ...v }))
      .sort((a, b) => b.costUsd - a.costUsd),
    usdPln: USD_PLN,
  }
}

export async function buildWeek(): Promise<{
  days: { date: string; sessions: number; tokens: number; costUsd: number }[]
  byProject: { project: string; sessions: number; tokens: number; costUsd: number }[]
  usdPln: number
}> {
  const days: { date: string; sessions: number; tokens: number; costUsd: number }[] = []
  const projects = new Map<string, { sessions: number; tokens: number; costUsd: number }>()

  for (let i = 6; i >= 0; i--) {
    const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)
    const day = await buildJournal(date)
    days.push({
      date,
      sessions: day.totals.sessions,
      tokens: day.totals.tokens,
      costUsd: day.totals.costUsd,
    })
    for (const p of day.byProject) {
      const acc = projects.get(p.project) ?? { sessions: 0, tokens: 0, costUsd: 0 }
      acc.sessions += p.sessions
      acc.tokens += p.tokens
      acc.costUsd += p.costUsd
      projects.set(p.project, acc)
    }
  }

  return {
    days,
    byProject: [...projects.entries()]
      .map(([project, v]) => ({ project, ...v }))
      .sort((a, b) => b.tokens - a.tokens),
    usdPln: USD_PLN,
  }
}

export async function buildJournal(date?: string): Promise<JournalDay> {
  const day = date ?? new Date().toISOString().slice(0, 10);
  const { from, to } = dayBounds(day);

  const scans = await scanAllSessions();
  const live = listLiveSessions();
  const activeBySessionId = new Map(
    live
      .filter((s) => s.sessionId)
      .map((s) => [s.sessionId!, s.info().activeMs]),
  );

  const entries: JournalEntry[] = scans
    .filter((s) => {
      const touched = s.lastModified;
      const started = s.createdAt ?? s.lastModified;
      // Sesja liczy się do dnia, jeśli zaczęła się albo była ruszana tego dnia.
      return (
        (touched >= from && touched < to) || (started >= from && started < to)
      );
    })
    .map((s) => ({
      sessionId: s.sessionId,
      title: s.title || "(bez nazwy)",
      project: s.cwd ? path.basename(s.cwd) : "(nieznany)",
      cwd: s.cwd,
      firstSeen: s.createdAt ?? s.lastModified,
      lastSeen: s.lastModified,
      messageCount: s.messageCount,
      tokens: totalTokens(s.usage),
      costUsd: s.costUsd,
      activeMs: activeBySessionId.get(s.sessionId),
    }))
    .sort((a, b) => b.lastSeen - a.lastSeen);

  const projects = new Map<
    string,
    { sessions: number; tokens: number; costUsd: number }
  >();
  for (const e of entries) {
    const p = projects.get(e.project) ?? { sessions: 0, tokens: 0, costUsd: 0 };
    p.sessions++;
    p.tokens += e.tokens;
    p.costUsd += e.costUsd;
    projects.set(e.project, p);
  }

  return {
    date: day,
    entries,
    byProject: [...projects.entries()]
      .map(([project, v]) => ({ project, ...v }))
      .sort((a, b) => b.tokens - a.tokens),
    doneTasks: await completedTasks(day),
    // Ranking bierze się z tych samych danych; liczy się to, co najdroższe.
    topCost: [...entries].sort((a, b) => b.costUsd - a.costUsd).slice(0, 5),
    usdPln: USD_PLN,
    totals: {
      sessions: entries.length,
      tokens: entries.reduce((sum, e) => sum + e.tokens, 0),
      costUsd: entries.reduce((sum, e) => sum + e.costUsd, 0),
      activeMs: entries.reduce((sum, e) => sum + (e.activeMs ?? 0), 0),
    },
  };
}
