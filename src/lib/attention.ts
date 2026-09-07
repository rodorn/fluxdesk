import fs from "node:fs/promises";
import path from "node:path";

import { dataDir } from "./store";

/**
 * Uwaga i rytm pracy. Panel widzi to, czego nie widzi żaden tracker czasu:
 * ile razy dziennie przeskakujesz między rozmowami, kiedy naprawdę pracujesz
 * i czy wieczorem wciąż zaczynasz nowe rzeczy.
 */

export type DayLog = {
  date: string;
  /** Przeskoki między sesjami: miara rozpraszania, nie wydajności. */
  switches: number;
  /** Znaczniki aktywności co pięć minut; z nich liczymy realny czas pracy. */
  activeSlots: string[];
  /** Cel dnia wpisany rano. */
  goal?: string;
  /** Czy cel został wieczorem uznany za osiągnięty. */
  goalDone?: boolean;
  /** Momenty, w których panel przypomniał o przerwie. */
  breaks: number[];
};

export type Settings = {
  /** Po tylu minutach nieprzerwanej pracy panel proponuje przerwę. */
  breakAfterMin: number;
  /** Godzina, po której panel odradza zaczynanie nowych sesji. */
  eveningFrom: number;
  /** Ciche godziny dla powiadomień: od, do. */
  quietFrom: number;
  quietTo: number;
};

export const DEFAULT_SETTINGS: Settings = {
  breakAfterMin: 90,
  eveningFrom: 22,
  quietFrom: 22,
  quietTo: 8,
};

type Store = { version: 1; days: Record<string, DayLog>; settings: Settings };

function file(): string {
  return path.join(dataDir(), "attention.json");
}

async function read(): Promise<Store> {
  try {
    const raw = JSON.parse(await fs.readFile(file(), "utf8")) as Store;
    return { ...raw, settings: { ...DEFAULT_SETTINGS, ...raw.settings } };
  } catch {
    return { version: 1, days: {}, settings: DEFAULT_SETTINGS };
  }
}

async function write(store: Store): Promise<void> {
  await fs.mkdir(path.dirname(file()), { recursive: true });
  await fs.writeFile(file(), JSON.stringify(store, null, 2), "utf8");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Znacznik pięciominutowego okna; sklejone dają realny czas przy pracy. */
function slot(at = new Date()): string {
  const minutes = Math.floor(at.getMinutes() / 5) * 5;
  return `${String(at.getHours()).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export async function recordActivity(kind: "switch" | "work"): Promise<void> {
  const store = await read();
  const date = today();
  const day = store.days[date] ?? {
    date,
    switches: 0,
    activeSlots: [],
    breaks: [],
  };

  if (kind === "switch") day.switches++;
  const current = slot();
  if (!day.activeSlots.includes(current)) day.activeSlots.push(current);

  store.days[date] = day;
  // Trzymamy kwartał; starsze dni nie mówią już nic o bieżącym rytmie.
  const keep = Object.keys(store.days).sort().slice(-90);
  store.days = Object.fromEntries(keep.map((k) => [k, store.days[k]]));
  await write(store);
}

export async function setGoal(goal: string, done?: boolean): Promise<DayLog> {
  const store = await read();
  const date = today();
  const day = store.days[date] ?? {
    date,
    switches: 0,
    activeSlots: [],
    breaks: [],
  };
  if (goal) day.goal = goal;
  if (done !== undefined) day.goalDone = done;
  store.days[date] = day;
  await write(store);
  return day;
}

export type AttentionReport = {
  date: string;
  switches: number;
  /** Realny czas przy pracy, wyliczony z pięciominutowych okien. */
  activeMin: number;
  /** Najdłuższy ciąg pracy bez przerwy. */
  longestStreakMin: number;
  goal?: string;
  goalDone?: boolean;
  settings: Settings;
  /** Czy trwają ciche godziny. */
  quietNow: boolean;
  /** Czy pora odradza zaczynanie nowych rzeczy. */
  eveningNow: boolean;
  /** Ostatnie dni dla porównania. */
  history: { date: string; switches: number; activeMin: number }[];
};

function streak(slots: string[]): number {
  const sorted = [...slots].sort();
  let best = 0;
  let current = 0;
  let previous: number | undefined;
  for (const s of sorted) {
    const [h, m] = s.split(":").map(Number);
    const minutes = h * 60 + m;
    // Przerwa dłuższa niż dziesięć minut kończy ciąg pracy.
    current =
      previous !== undefined && minutes - previous <= 10 ? current + 5 : 5;
    previous = minutes;
    best = Math.max(best, current);
  }
  return best;
}

export async function attentionReport(): Promise<AttentionReport> {
  const store = await read();
  const date = today();
  const day = store.days[date] ?? {
    date,
    switches: 0,
    activeSlots: [],
    breaks: [],
  };
  const hour = new Date().getHours();
  const { quietFrom, quietTo, eveningFrom } = store.settings;

  return {
    date,
    switches: day.switches,
    activeMin: day.activeSlots.length * 5,
    longestStreakMin: streak(day.activeSlots),
    goal: day.goal,
    goalDone: day.goalDone,
    settings: store.settings,
    quietNow:
      quietFrom > quietTo
        ? hour >= quietFrom || hour < quietTo
        : hour >= quietFrom && hour < quietTo,
    eveningNow: hour >= eveningFrom,
    history: Object.values(store.days)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14)
      .map((d) => ({
        date: d.date,
        switches: d.switches,
        activeMin: d.activeSlots.length * 5,
      })),
  };
}

export async function updateSettings(
  patch: Partial<Settings>,
): Promise<Settings> {
  const store = await read();
  store.settings = { ...store.settings, ...patch };
  await write(store);
  return store.settings;
}
