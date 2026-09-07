import fs from "node:fs/promises";

import { listTranscriptFiles } from "./transcript";

/**
 * Lekki skan transkryptów. Pełny odczyt 1,3 GB plików trwa minuty, a do listy
 * sesji potrzebne są tylko metadane: katalog, czas startu i nazwa. Jedno i drugie
 * leży na krańcach pliku — początek ma `cwd` i pierwszy prompt, koniec zapisy
 * `custom-title` / `ai-title`. Czytamy więc tylko krańce.
 */

const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 256 * 1024;

export type LightScan = {
  sessionId: string;
  file: string;
  cwd?: string;
  gitBranch?: string;
  createdAt?: number;
  lastModified: number;
  /**
   * Czas ostatniej wypowiedzi. Data modyfikacji pliku nie nadaje się do
   * sortowania rozmów, bo CLI dopisuje do transkryptu także tytuły, migawki
   * plików i zmiany trybu, przez co cicha sesja potrafi skoczyć na górę listy.
   */
  lastMessageAt?: number;
  size: number;
  title?: string;
};

type CacheEntry = { mtimeMs: number; size: number; scan: LightScan };
const globalRef = globalThis as unknown as {
  __csmLightScan?: Map<string, CacheEntry>;
};
const cache: Map<string, CacheEntry> = (globalRef.__csmLightScan ??= new Map());

async function readEdges(
  file: string,
  size: number,
): Promise<{ head: string; tail: string }> {
  const handle = await fs.open(file, "r");
  try {
    const headLen = Math.min(HEAD_BYTES, size);
    const headBuf = Buffer.alloc(headLen);
    await handle.read(headBuf, 0, headLen, 0);

    const tailLen = Math.min(TAIL_BYTES, Math.max(0, size - headLen));
    let tail = "";
    if (tailLen > 0) {
      const tailBuf = Buffer.alloc(tailLen);
      await handle.read(tailBuf, 0, tailLen, size - tailLen);
      tail = tailBuf.toString("utf8");
    }
    return { head: headBuf.toString("utf8"), tail };
  } finally {
    await handle.close();
  }
}

/** Parsuje kompletne linie JSON, pomijając urwane krańce odczytu. */
function* jsonLines(chunk: string): Generator<Record<string, unknown>> {
  const lines = chunk.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) continue;
    try {
      yield JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      /* urwana linia na granicy odczytu */
    }
  }
}

function firstText(message: unknown): string | undefined {
  const content = (message as { content?: unknown })?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  for (const block of content) {
    const b = block as { type?: string; text?: string };
    if (b?.type === "text" && typeof b.text === "string" && b.text.trim())
      return b.text.trim();
  }
  return undefined;
}

async function scanOne(f: {
  sessionId: string;
  file: string;
  mtimeMs: number;
  size: number;
}): Promise<LightScan> {
  const cached = cache.get(f.file);
  if (cached && cached.mtimeMs === f.mtimeMs && cached.size === f.size)
    return cached.scan;

  const scan: LightScan = {
    sessionId: f.sessionId,
    file: f.file,
    lastModified: f.mtimeMs,
    size: f.size,
  };

  try {
    const { head, tail } = await readEdges(f.file, f.size);

    for (const raw of jsonLines(head)) {
      if (!scan.cwd && typeof raw.cwd === "string") scan.cwd = raw.cwd;
      if (
        !scan.gitBranch &&
        typeof raw.gitBranch === "string" &&
        raw.gitBranch
      ) {
        scan.gitBranch = raw.gitBranch;
      }
      if (scan.createdAt === undefined && typeof raw.timestamp === "string") {
        const t = Date.parse(raw.timestamp);
        if (!Number.isNaN(t)) scan.createdAt = t;
      }
      if (!scan.title && raw.type === "user") {
        const text = firstText(raw.message);
        if (text && !text.startsWith("<")) scan.title = text.slice(0, 100);
      }
    }

    // Nazwa nadana ręcznie bije wygenerowaną, a obie bywają zapisywane wielokrotnie.
    let custom: string | undefined;
    let ai: string | undefined;
    for (const raw of jsonLines(tail || head)) {
      if (raw.type === "custom-title" && typeof raw.customTitle === "string") {
        custom = raw.customTitle;
      } else if (raw.type === "ai-title" && typeof raw.aiTitle === "string") {
        ai = raw.aiTitle;
      } else if (
        raw.type === "summary" &&
        typeof raw.summary === "string" &&
        !ai
      ) {
        ai = raw.summary;
      }

      // Do sortowania liczą się tylko wypowiedzi, nie zapisy techniczne.
      if (
        (raw.type === "user" || raw.type === "assistant") &&
        typeof raw.timestamp === "string"
      ) {
        const t = Date.parse(raw.timestamp);
        if (!Number.isNaN(t) && t > (scan.lastMessageAt ?? 0)) {
          scan.lastMessageAt = t;
        }
      }
    }
    if (custom || ai) scan.title = custom || ai;
  } catch {
    /* plik zniknął albo jest nieczytelny — zostają same metadane z katalogu */
  }

  cache.set(f.file, { mtimeMs: f.mtimeMs, size: f.size, scan });
  return scan;
}

export async function lightScanAll(): Promise<LightScan[]> {
  const files = await listTranscriptFiles();
  const out: LightScan[] = [];
  const CONCURRENCY = 16;
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const chunk = files.slice(i, i + CONCURRENCY);
    out.push(...(await Promise.all(chunk.map(scanOne))));
  }
  return out;
}
