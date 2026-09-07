import fs from "node:fs/promises";

import { lightScanAll } from "./lightscan";

/**
 * Sesje Claude Code uruchomione poza panelem — zwykłe `claude` w oknach terminala.
 * Panel nie może przejąć ich TTY, ale może je pokazać, podpowiedzieć wznowienie
 * i pozwolić posprzątać te, o których dawno zapomniałeś.
 */
export type ExternalSession = {
  pid: number;
  cwd?: string;
  startedAt?: number;
  /** Rezydentna pamięć procesu w bajtach. */
  rss: number;
  /** Terminal, w którym siedzi proces (numer urządzenia), albo brak. */
  tty?: string;
  /** Czy proces został uruchomiony przez ten panel. */
  ownedByPanel: boolean;
  /** Sesja z transkryptu dopasowana po katalogu i czasie startu. */
  sessionId?: string;
  /** Nazwa sesji do pokazania (tytuł, streszczenie albo pierwszy prompt). */
  title?: string;
  /** Kiedy transkrypt tej sesji był ostatnio zapisywany. */
  lastActivity?: number;

  /** Jak pewne jest wiązanie procesu z transkryptem. */
  match?: "time" | "guess";
};

const CLOCK_TICKS = 100;

async function bootTimeMs(): Promise<number> {
  try {
    const stat = await fs.readFile("/proc/stat", "utf8");
    const btime = /^btime\s+(\d+)$/m.exec(stat)?.[1];
    if (btime) return Number(btime) * 1000;
  } catch {
    /* nie na Linuksie albo brak dostępu */
  }
  return 0;
}

/** Zbiera przodków procesu, żeby rozpoznać potomków panelu. */
async function ancestors(pid: number, limit = 12): Promise<number[]> {
  const out: number[] = [];
  let current = pid;
  for (let i = 0; i < limit && current > 1; i++) {
    try {
      const stat = await fs.readFile(`/proc/${current}/stat`, "utf8");
      const after = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const ppid = Number(after[1]);
      if (!Number.isFinite(ppid) || ppid <= 0) break;
      out.push(ppid);
      current = ppid;
    } catch {
      break;
    }
  }
  return out;
}

function isClaudeCommand(cmdline: string): boolean {
  const parts = cmdline.split("\0").filter(Boolean);
  if (!parts.length) return false;
  const joined = parts.join(" ");
  // Interesuje nas CLI Claude Code, a nie dowolny proces z tym słowem w argumentach.
  return (
    /(^|\/)claude($|\s)/.test(parts[0]) ||
    /\/(\.local|node_modules)\/.*\/claude\b/.test(joined)
  );
}

type ProcCache = { at: number; items: ExternalSession[]; refreshing?: boolean };
const procRef = globalThis as unknown as { __csmProcCache?: ProcCache };

/**
 * Skan /proc plus dopasowanie transkryptów kosztuje setki milisekund, a pulpit
 * odpytuje listę cyklicznie. Oddajemy więc ostatni wynik od ręki i odświeżamy go
 * w tle — świeżość liczy się tu mniej niż to, żeby interfejs nie czekał.
 */
const PROC_TTL_MS = 30_000;

async function refresh(): Promise<ExternalSession[]> {
  const items = await scanProcesses();
  procRef.__csmProcCache = { at: Date.now(), items };
  return items;
}

export async function listExternalSessions(force = false): Promise<ExternalSession[]> {
  const cached = procRef.__csmProcCache;
  if (force || !cached) return refresh();

  if (Date.now() - cached.at >= PROC_TTL_MS && !cached.refreshing) {
    cached.refreshing = true;
    void refresh().finally(() => {
      const current = procRef.__csmProcCache;
      if (current) current.refreshing = false;
    });
  }
  return cached.items;
}

/** Podgrzewa cache przy starcie, żeby pierwsze wejście na pulpit nie czekało. */
export function warmExternalSessions(): void {
  if (!procRef.__csmProcCache) void refresh().catch(() => undefined);
}

async function scanProcesses(): Promise<ExternalSession[]> {
  let entries: string[];
  try {
    entries = await fs.readdir("/proc");
  } catch {
    return [];
  }

  const boot = await bootTimeMs();
  const self = process.pid;
  const out: ExternalSession[] = [];

  for (const name of entries) {
    const pid = Number(name);
    if (!Number.isInteger(pid) || pid <= 0) continue;

    let cmdline: string;
    try {
      cmdline = await fs.readFile(`/proc/${pid}/cmdline`, "utf8");
    } catch {
      continue;
    }
    if (!isClaudeCommand(cmdline)) continue;

    const cwd = await fs.readlink(`/proc/${pid}/cwd`).catch(() => undefined);

    let startedAt: number | undefined;
    let rss = 0;
    try {
      const stat = await fs.readFile(`/proc/${pid}/stat`, "utf8");
      const after = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const starttime = Number(after[19]);
      if (boot && Number.isFinite(starttime))
        startedAt = boot + (starttime / CLOCK_TICKS) * 1000;
      const rssPages = Number(after[21]);
      if (Number.isFinite(rssPages)) rss = rssPages * 4096;
    } catch {
      /* proces zniknął w trakcie odczytu */
    }

    const parents = await ancestors(pid);
    out.push({
      pid,
      cwd,
      startedAt,
      rss,
      ownedByPanel: parents.includes(self) || pid === self,
    });
  }

  await attachSessions(out);
  return out.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
}

/**
 * Dopina do procesów ich transkrypty. Proces nie trzyma pliku sesji otwartego,
 * więc jedyne wiązanie to katalog roboczy plus zbieżność czasu startu — dopasowanie
 * idzie od najlepszej pary, żeby dwa procesy nie dostały tej samej sesji.
 */
async function attachSessions(procs: ExternalSession[]) {
  if (!procs.length) return
  let scans: Awaited<ReturnType<typeof lightScanAll>>
  try {
    scans = await lightScanAll()
  } catch {
    return
  }

  type Pair = { proc: ExternalSession; scan: (typeof scans)[number]; distance: number }
  const pairs: Pair[] = []
  for (const proc of procs) {
    if (!proc.cwd || !proc.startedAt) continue
    for (const scan of scans) {
      if (scan.cwd !== proc.cwd) continue
      const created = scan.createdAt
      if (!created) continue
      // Transkrypt powstaje chwilę po starcie procesu; sesje wznowione mogą być starsze.
      const distance = Math.abs(created - proc.startedAt)
      if (distance > 15 * 60_000) continue
      pairs.push({ proc, scan, distance })
    }
  }

  pairs.sort((a, b) => a.distance - b.distance)
  const usedScans = new Set<string>()
  const usedProcs = new Set<number>()
  for (const { proc, scan } of pairs) {
    if (usedScans.has(scan.sessionId) || usedProcs.has(proc.pid)) continue
    usedScans.add(scan.sessionId)
    usedProcs.add(proc.pid)
    assign(proc, scan, 'time')
  }

  // Drugi przebieg: procesy bez trafienia w czas dostają transkrypty z tego samego
  // katalogu, od najświeższego — sesja wznawiana ma createdAt sprzed dni, więc
  // pierwszy przebieg jej nie łapie.
  const leftovers = procs.filter((p) => !p.sessionId && p.cwd)
  if (!leftovers.length) return
  const byCwd = new Map<string, typeof scans>()
  for (const scan of scans) {
    if (!scan.cwd || usedScans.has(scan.sessionId)) continue
    const list = byCwd.get(scan.cwd) ?? []
    list.push(scan)
    byCwd.set(scan.cwd, list)
  }
  for (const list of byCwd.values()) list.sort((a, b) => b.lastModified - a.lastModified)

  for (const proc of leftovers.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))) {
    const list = byCwd.get(proc.cwd!)
    const scan = list?.shift()
    if (!scan) continue
    usedScans.add(scan.sessionId)
    assign(proc, scan, 'guess')
  }

  function assign(
    proc: ExternalSession,
    scan: (typeof scans)[number],
    match: 'time' | 'guess'
  ) {
    proc.sessionId = scan.sessionId
    proc.title = scan.title
    proc.lastActivity = scan.lastModified
    proc.match = match
  }
}

/** Kończy proces sesji uruchomionej poza panelem. */
export async function killExternalSession(pid: number, force = false) {
  const all = await listExternalSessions(true);
  const target = all.find((p) => p.pid === pid);
  if (!target) throw new Error("Nie znaleziono takiego procesu Claude");
  process.kill(pid, force ? "SIGKILL" : "SIGTERM");
  return { ok: true, pid, signal: force ? "SIGKILL" : "SIGTERM" };
}
