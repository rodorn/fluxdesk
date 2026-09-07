import fs from "node:fs/promises";
import path from "node:path";

import { claudeConfigDir } from "./config";

/**
 * Pamięć o użytkowniku. Źródłem prawdy jest ~/.claude/knowledge/about_me.json,
 * a panel dokłada dwie rzeczy: edycję sekcja po sekcji oraz eksport skrótu do
 * globalnego CLAUDE.md, żeby każda sesja — nie tylko ta uruchomiona z panelu —
 * wiedziała, z kim rozmawia.
 */

export type ProfileSection = {
  key: string;
  /** Zawartość sekcji: wartość prosta, lista albo obiekt. */
  value: unknown;
  /** Czy sekcja trafia do CLAUDE.md widocznego dla wszystkich agentów. */
  shared: boolean;
};

export type Profile = {
  path: string;
  modified?: number;
  sections: ProfileSection[];
};

const START = "<!-- fluxdesk:profile:start -->";
const END = "<!-- fluxdesk:profile:end -->";

/** Sekcje trzymane poza kontekstem agentów, dopóki użytkownik nie zdecyduje inaczej. */
const PRIVATE_BY_DEFAULT = new Set([
  "income",
  "investments",
  "work",
  "clickup",
  "courses",
  "inspirations",
]);

/**
 * Blok w CLAUDE.md ląduje w każdym prompcie każdej sesji, więc musi być skrótem.
 * Sekcja dłuższa niż limit jest przycinana z adnotacją, gdzie leży pełna wersja.
 */
const SECTION_CHAR_LIMIT = 1200;
const TOTAL_CHAR_LIMIT = 6000;

export function profilePath(): string {
  return path.join(claudeConfigDir(), "knowledge", "about_me.json");
}

function settingsPath(): string {
  return path.join(claudeConfigDir(), "knowledge", "about_me.sharing.json");
}

async function readSharing(): Promise<Record<string, boolean>> {
  try {
    return JSON.parse(await fs.readFile(settingsPath(), "utf8")) as Record<
      string,
      boolean
    >;
  } catch {
    return {};
  }
}

export async function readProfile(): Promise<Profile> {
  const file = profilePath();
  let raw: Record<string, unknown> = {};
  let modified: number | undefined;
  try {
    raw = JSON.parse(await fs.readFile(file, "utf8")) as Record<
      string,
      unknown
    >;
    modified = (await fs.stat(file)).mtimeMs;
  } catch {
    raw = {};
  }
  const sharing = await readSharing();

  return {
    path: file,
    modified,
    sections: Object.entries(raw).map(([key, value]) => ({
      key,
      value,
      shared: sharing[key] ?? !PRIVATE_BY_DEFAULT.has(key),
    })),
  };
}

/** Zapisuje jedną sekcję (albo ją usuwa, gdy `value` jest `undefined`). */
export async function writeSection(
  key: string,
  value: unknown,
): Promise<Profile> {
  const file = profilePath();
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(await fs.readFile(file, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    raw = {};
  }
  if (value === undefined) delete raw[key];
  else raw[key] = value;

  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(raw, null, 2) + "\n", "utf8");
  await syncToClaudeMd();
  return readProfile();
}

export async function setShared(
  key: string,
  shared: boolean,
): Promise<Profile> {
  const sharing = await readSharing();
  sharing[key] = shared;
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fs.writeFile(
    settingsPath(),
    JSON.stringify(sharing, null, 2) + "\n",
    "utf8",
  );
  await syncToClaudeMd();
  return readProfile();
}

/** Spłaszcza wartość sekcji do czytelnych linii — CLAUDE.md ma być skrótem, nie zrzutem. */
function renderValue(value: unknown, indent = ""): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap((v) =>
      typeof v === "object" && v !== null
        ? renderValue(v, indent + "  ")
        : [`${indent}- ${String(v)}`],
    );
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      typeof v === "object" && v !== null
        ? [`${indent}- ${k}:`, ...renderValue(v, indent + "  ")]
        : [`${indent}- ${k}: ${String(v)}`],
    );
  }
  return [`${indent}- ${String(value)}`];
}

export async function renderForAgents(): Promise<string> {
  const profile = await readProfile();
  const shared = profile.sections.filter((s) => s.shared);
  if (!shared.length) return "";

  const lines: string[] = [
    "## O użytkowniku",
    "",
    `Wiedza o Pawle, utrzymywana w \`${profile.path}\` i edytowana w panelu Fluxdesk.`,
    "Nie zgaduj tych faktów i nie pytaj o nie ponownie; jeśli coś się zdezaktualizowało, powiedz o tym.",
    "",
  ];
  let budget = TOTAL_CHAR_LIMIT;
  for (const section of shared) {
    const body = renderValue(section.value).join("\n");
    if (!body) continue;

    let text = body;
    if (text.length > SECTION_CHAR_LIMIT) {
      text = text.slice(0, SECTION_CHAR_LIMIT) + "\n  … (skrócone, pełna wersja w pliku)";
    }
    if (text.length > budget) {
      lines.push(`### ${section.key}`);
      lines.push("- (pominięte — limit skrótu; szczegóły w pliku profilu)");
      lines.push("");
      continue;
    }
    budget -= text.length;
    lines.push(`### ${section.key}`);
    lines.push(text);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

/**
 * Wstawia skrót profilu do ~/.claude/CLAUDE.md między znaczniki. Dzięki temu
 * wiedzę widzi każda sesja Claude Code na tej maszynie, nie tylko panel.
 */
export async function syncToClaudeMd(): Promise<{
  bytes: number;
  sections: number;
}> {
  const target = path.join(claudeConfigDir(), "CLAUDE.md");
  const block = await renderForAgents();
  const profile = await readProfile();

  let current = "";
  try {
    current = await fs.readFile(target, "utf8");
  } catch {
    current = "";
  }

  const body = block ? `${START}\n${block}\n${END}` : "";
  const start = current.indexOf(START);
  const end = current.indexOf(END);

  let next: string;
  if (start !== -1 && end !== -1 && end > start) {
    next = current.slice(0, start) + body + current.slice(end + END.length);
  } else if (body) {
    next = current.trimEnd() + "\n\n" + body + "\n";
  } else {
    next = current;
  }

  if (next !== current) await fs.writeFile(target, next, "utf8");
  return {
    bytes: body.length,
    sections: profile.sections.filter((s) => s.shared).length,
  };
}
