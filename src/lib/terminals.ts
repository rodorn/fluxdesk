import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import { isCwdAllowed } from "./config";
import { lightScanAll } from "./lightscan";
import { sessionEnv } from "./secrets";
import { dataDir } from "./store";

/**
 * Terminale z prawdziwym `claude`. Każdy działa w osobnym procesie-gospodarzu
 * (scripts/pty-host.mjs), który trzyma pty i wystawia je na gnieździe uniksowym.
 * Dzięki temu restart panelu, a nawet jego przebudowa, nie przerywa pracy:
 * panel po powrocie po prostu podłącza się z powrotem.
 */

export type TerminalOptions = {
  cwd: string;
  /** Host ssh, gdy sesja ma ruszyć na innej maszynie (na przykład na VPS-ie). */
  host?: string;
  title?: string;
  model?: string;
  permissionMode?: string;
  resume?: string;
  cols?: number;
  rows?: number;
};

export type TerminalInfo = {
  id: string;
  kind: "terminal";
  title: string;
  cwd: string;
  model?: string;
  permissionMode: string;
  startedAt: number;
  lastOutputAt: number;
  alive: boolean;
  exitCode?: number;
  cols: number;
  rows: number;
  chunks: number;
  /** PID gospodarza; przydaje się, gdy trzeba go ubić z zewnątrz. */
  hostPid?: number;
  /** Ostatnia widoczna linia ekranu — podgląd na liście rozmów. */
  lastLine?: string;
  /** Czas ostatniej wiadomości w rozmowie, a nie ostatniego drgnięcia ekranu. */
  lastMessageAt?: number;
  /** Identyfikator rozmowy: z `--resume` albo dopasowany po katalogu i czasie. */
  sessionId?: string;
  /** Inne terminale prowadzące tę samą rozmowę. */
  duplicateOf?: string;
  /** Host ssh, gdy sesja działa na innej maszynie. */
  host?: string;
  /** Dozorca: czy sesja robi to samo zbyt długo. */
  stuck?: { stuck: boolean; sinceMs: number };
};

type HostMeta = TerminalInfo & {
  socket: string;
  args: string[];
  /** Polecenie do uruchomienia; domyślnie `claude`, dla sesji zdalnych `ssh`. */
  command?: string;
  env?: Record<string, string>;
};

function hostsDir(): string {
  return path.join(dataDir(), "terminals");
}

/** Argumenty CLI odpowiadające ustawieniom sesji. */
function claudeArgs(opts: TerminalOptions): string[] {
  const args: string[] = [];
  if (opts.resume) args.push("--resume", opts.resume);
  if (opts.model) args.push("--model", opts.model);
  if (opts.permissionMode === "bypassPermissions")
    args.push("--dangerously-skip-permissions");
  else if (opts.permissionMode && opts.permissionMode !== "default") {
    args.push("--permission-mode", opts.permissionMode);
  }
  return args;
}

async function readMeta(id: string): Promise<HostMeta | undefined> {
  try {
    return JSON.parse(
      await fs.readFile(path.join(hostsDir(), `${id}.json`), "utf8"),
    ) as HostMeta;
  } catch {
    return undefined;
  }
}

async function writeMeta(meta: HostMeta): Promise<void> {
  await fs.mkdir(hostsDir(), { recursive: true });
  await fs.writeFile(
    path.join(hostsDir(), `${meta.id}.json`),
    JSON.stringify(meta, null, 2),
    {
      mode: 0o600,
    },
  );
}

/** Sesja wznowiona przez `--resume` zna swój identyfikator z własnych argumentów. */
function resumedSessionId(args?: string[]): string | undefined {
  if (!args) return undefined;
  const i = args.indexOf("--resume");
  return i >= 0 ? args[i + 1] : undefined;
}

function processAlive(pid?: number): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function toInfo(meta: HostMeta): TerminalInfo {
  const alive = meta.alive !== false && processAlive(meta.hostPid);
  return {
    id: meta.id,
    kind: "terminal",
    title: meta.title,
    cwd: meta.cwd,
    model: meta.model,
    permissionMode: meta.permissionMode,
    startedAt: meta.startedAt,
    lastOutputAt: meta.lastOutputAt ?? meta.startedAt,
    alive,
    exitCode: meta.exitCode,
    cols: meta.cols ?? 120,
    rows: meta.rows ?? 32,
    chunks: meta.chunks ?? 0,
    hostPid: meta.hostPid,
    lastLine: meta.lastLine,
    lastMessageAt: meta.lastMessageAt,
    host: meta.host,
    sessionId: meta.sessionId ?? resumedSessionId(meta.args),
  };
}

export async function startTerminal(
  opts: TerminalOptions,
): Promise<TerminalInfo> {
  if (!isCwdAllowed(opts.cwd)) {
    throw new Error(
      `Katalog ${opts.cwd} nie jest na liście dozwolonych (CSM_ALLOWED_ROOTS)`,
    );
  }

  const id = randomUUID();
  const dir = hostsDir();
  await fs.mkdir(dir, { recursive: true });

  const meta: HostMeta = {
    id,
    kind: "terminal",
    title:
      opts.title || opts.cwd.split("/").filter(Boolean).pop() || "terminal",
    cwd: opts.cwd,
    model: opts.model,
    permissionMode: opts.permissionMode ?? "default",
    startedAt: Date.now(),
    lastOutputAt: Date.now(),
    alive: true,
    cols: opts.cols ?? 120,
    rows: opts.rows ?? 32,
    chunks: 0,
    socket: path.join(dir, `${id}.sock`),
    // Sesja zdalna to ten sam `claude`, tylko odpalony przez ssh na drugiej maszynie.
    command: opts.host ? "ssh" : undefined,
    args: opts.host
      ? ["-tt", opts.host, `cd ${JSON.stringify(opts.cwd)} && claude ${claudeArgs(opts).join(" ")}`]
      : claudeArgs(opts),
    host: opts.host,
    env: await sessionEnv(),
  };
  await writeMeta(meta);

  const script = path.join(process.cwd(), "scripts", "pty-host.mjs");
  const child = spawn(
    process.execPath,
    [script, meta.socket, path.join(dir, `${id}.json`)],
    {
      detached: true,
      stdio: "ignore",
      cwd: process.cwd(),
    },
  );
  child.unref();

  // Gospodarz zgłasza gotowość, dopisując swój PID do metadanych.
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const fresh = await readMeta(id);
    if (fresh?.hostPid) return toInfo(fresh);
  }
  throw new Error("Gospodarz terminala nie wystartował");
}

/**
 * Nowy terminal nazywa się tak jak katalog, bo w chwili startu rozmowa nie ma
 * jeszcze tematu. Gdy CLI nada jej tytuł, dopisujemy go po katalogu i czasie
 * startu, tak samo jak przy sesjach uruchomionych poza panelem.
 */
async function enrichTitles(items: TerminalInfo[]): Promise<void> {
  if (!items.length) return;

  let scans: Awaited<ReturnType<typeof lightScanAll>>;
  try {
    scans = await lightScanAll();
  } catch {
    return;
  }

  // Wznowione rozmowy mają identyfikator, więc znamy ich transkrypt na pewno.
  const byId = new Map(scans.map((s) => [s.sessionId, s]));
  for (const item of items) {
    const scan = item.sessionId ? byId.get(item.sessionId) : undefined;
    if (!scan) continue;
    item.lastMessageAt = scan.lastMessageAt ?? scan.lastModified;
    const dir = item.cwd.split("/").filter(Boolean).pop() ?? "";
    if (scan.title && (item.title === dir || item.title === "terminal"))
      item.title = scan.title;
  }

  // Sesja startowana bez wznowienia też ma swój transkrypt: zakłada go chwilę
  // po uruchomieniu. Bez tego panel nie wie, że dwa okna prowadzą jedną rozmowę.
  const taken = new Set(items.map((t) => t.sessionId).filter(Boolean));
  for (const item of items) {
    if (item.sessionId) continue;
    const candidate = scans
      .filter((s) => s.cwd === item.cwd && s.createdAt)
      .filter((s) => {
        const delta = (s.createdAt ?? 0) - item.startedAt;
        // Transkrypt powstaje po starcie procesu, nie przed nim.
        return delta > -30_000 && delta < 5 * 60_000;
      })
      // Zajęty transkrypt nie dyskwalifikuje kandydata: dwa okna nad jedną
      // rozmową to właśnie sytuacja, którą chcemy wykryć, a nie ukryć.
      .sort((a, b) => {
        const free =
          Number(taken.has(a.sessionId)) - Number(taken.has(b.sessionId));
        if (free !== 0) return free;
        return (
          Math.abs((a.createdAt ?? 0) - item.startedAt) -
          Math.abs((b.createdAt ?? 0) - item.startedAt)
        );
      })
      .at(0);

    if (!candidate) continue;
    item.sessionId = candidate.sessionId;
    taken.add(candidate.sessionId);
    item.lastMessageAt = candidate.lastMessageAt ?? candidate.lastModified;
  }

  // Ta sama rozmowa otwarta w dwóch oknach grozi tym, że każde nadpisze drugie.
  const bySession = new Map<string, TerminalInfo[]>();
  for (const item of items) {
    if (!item.sessionId) continue;
    const list = bySession.get(item.sessionId) ?? [];
    list.push(item);
    bySession.set(item.sessionId, list);
  }
  for (const list of bySession.values()) {
    if (list.length < 2) continue;
    const oldest = [...list].sort((a, b) => a.startedAt - b.startedAt)[0];
    for (const item of list) {
      if (item.id !== oldest.id) item.duplicateOf = oldest.id;
    }
  }

  const generic = items.filter((t) => {
    const dir = t.cwd.split("/").filter(Boolean).pop() ?? "";
    return !t.sessionId && (t.title === dir || t.title === "terminal");
  });

  for (const item of generic) {
    const candidate = scans
      .filter((s) => s.cwd === item.cwd && s.title && s.createdAt)
      .filter(
        (s) => Math.abs((s.createdAt ?? 0) - item.startedAt) < 10 * 60_000,
      )
      .sort(
        (a, b) =>
          Math.abs((a.createdAt ?? 0) - item.startedAt) -
          Math.abs((b.createdAt ?? 0) - item.startedAt),
      )
      .at(0);

    if (candidate?.title) {
      item.title = candidate.title;
      item.lastMessageAt = candidate.lastMessageAt ?? candidate.lastModified;
    }
  }
}

export async function listTerminals(): Promise<TerminalInfo[]> {
  let names: string[];
  try {
    names = await fs.readdir(hostsDir());
  } catch {
    return [];
  }

  const out: TerminalInfo[] = [];
  for (const name of names.filter((n) => n.endsWith(".json"))) {
    const meta = await readMeta(name.replace(/\.json$/, ""));
    if (!meta) continue;
    const info = toInfo(meta);
    // Gospodarz padł razem z terminalem, więc sprzątamy po nim.
    if (!info.alive && !processAlive(meta.hostPid)) {
      await removeTerminal(info.id).catch(() => undefined);
      continue;
    }
    out.push(info);
  }
  await enrichTitles(out);
  // Kolejność wg rozmowy, nie wg animacji na ekranie.
  return out.sort(
    (a, b) =>
      (b.lastMessageAt ?? b.lastOutputAt) - (a.lastMessageAt ?? a.lastOutputAt),
  );
}

export async function getTerminal(
  id: string,
): Promise<TerminalInfo | undefined> {
  const meta = await readMeta(id);
  return meta ? toInfo(meta) : undefined;
}

export async function removeTerminal(id: string): Promise<boolean> {
  const meta = await readMeta(id);
  if (!meta) return false;
  if (processAlive(meta.hostPid)) {
    try {
      process.kill(meta.hostPid!, "SIGTERM");
    } catch {
      /* zdążył się zakończyć */
    }
  }
  await fs.rm(path.join(hostsDir(), `${id}.json`), { force: true });
  await fs.rm(meta.socket, { force: true });
  return true;
}

export async function setTerminalTitle(
  id: string,
  title: string,
): Promise<TerminalInfo> {
  const meta = await readMeta(id);
  if (!meta) throw new Error("Nie znaleziono terminala");
  meta.title = title;
  await writeMeta(meta);
  return toInfo(meta);
}

/* ------------------------------------------------------------------ */
/* Połączenie z gospodarzem                                            */
/* ------------------------------------------------------------------ */

export type HostMessage =
  | { t: "snapshot"; d: string; alive: boolean; exitCode?: number }
  | { t: "data"; d: string }
  | { t: "exit"; code: number };

/** Otwiera połączenie z gospodarzem i woła `onMessage` dla każdej wiadomości. */
export async function connectTerminal(
  id: string,
  onMessage: (msg: HostMessage) => void,
): Promise<{ send: (msg: unknown) => void; close: () => void }> {
  const meta = await readMeta(id);
  if (!meta) throw new Error("Nie znaleziono terminala");

  const socket = net.connect(meta.socket);
  socket.setNoDelay(true);

  let pending = "";
  socket.on("data", (chunk) => {
    pending += chunk.toString("utf8");
    let index: number;
    while ((index = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, index);
      pending = pending.slice(index + 1);
      if (!line.trim()) continue;
      try {
        onMessage(JSON.parse(line) as HostMessage);
      } catch {
        /* uszkodzona linia */
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("error", reject);
  });

  return {
    send: (msg: unknown) => {
      try {
        socket.write(JSON.stringify(msg) + "\n");
      } catch {
        /* połączenie zerwane */
      }
    },
    close: () => socket.destroy(),
  };
}

/** Jednorazowa wysyłka do gospodarza (wejście, zmiana rozmiaru, zakończenie). */
export async function sendToTerminal(id: string, msg: unknown): Promise<void> {
  const conn = await connectTerminal(id, () => undefined);
  conn.send(msg);
  // Dajemy chwilę na wypchnięcie bajtów przed zamknięciem gniazda.
  setTimeout(() => conn.close(), 50);
}
