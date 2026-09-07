import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { handle } from "@/lib/api";

const run = promisify(execFile);

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type Limits = {
  /** Zużycie okna pięciogodzinnego w procentach. */
  sessionPct?: number;
  /** Zużycie limitu tygodniowego w procentach. */
  weekPct?: number;
  sessionReset?: string;
  weekReset?: string;
  /** Kiedy limit skończy się przy obecnym tempie, jeśli w ogóle. */
  forecast?: string;
  available: boolean;
};

type Sample = { at: number; weekPct: number };
const store = globalThis as unknown as { __csmLimitHistory?: Sample[] };
const history: Sample[] = (store.__csmLimitHistory ??= []);

/**
 * Prognoza wyczerpania limitu. Sama informacja „zużyłeś 40 procent” nic nie
 * mówi, dopóki nie wiadomo, czy to wynik ostatniej godziny, czy trzech dni,
 * więc liczymy tempo z próbek zbieranych w tle.
 */
function forecast(weekPct: number): string | undefined {
  history.push({ at: Date.now(), weekPct });
  // Doba wstecz wystarczy; starsze próbki nie opisują już bieżącego tempa.
  while (history.length > 2 && Date.now() - history[0].at > 86_400_000) {
    history.shift();
  }
  if (history.length < 3) return undefined;

  const first = history[0];
  const hours = (Date.now() - first.at) / 3_600_000;
  if (hours < 0.5) return undefined;

  const perHour = (weekPct - first.weekPct) / hours;
  if (perHour <= 0.05) return "tempo znikome";

  const hoursLeft = (100 - weekPct) / perHour;
  if (hoursLeft > 168) return "limit wystarczy z zapasem";
  if (hoursLeft < 1) return "limit na wyczerpaniu";
  if (hoursLeft < 24)
    return `przy tym tempie limit skończy się za ${Math.round(hoursLeft)} h`;
  return `przy tym tempie limit skończy się za ${Math.round(hoursLeft / 24)} dni`;
}

type Cache = { at: number; data: Limits };
const ref = globalThis as unknown as { __csmLimits?: Cache };

/** Limity zmieniają się wolno, a skrypt liczy je z transkryptów, więc cache. */
const TTL_MS = 60_000;

/**
 * Zużycie limitów tokenów. Korzystamy ze skryptu, który użytkownik ma już
 * podpięty do paska Waybar, żeby panel i pasek pokazywały tę samą liczbę.
 */
async function readLimits(): Promise<Limits> {
  const script = path.join(
    os.homedir(),
    ".config",
    "ml4w",
    "scripts",
    "claude-usage.py",
  );
  try {
    const { stdout } = await run("python3", [script], { timeout: 15_000 });
    const raw = JSON.parse(stdout) as { tooltip?: string; percentage?: number };
    const tooltip = raw.tooltip ?? "";

    const session = /Session:\s*(\d+)%\s*\(reset za ([^,)]+)/i.exec(tooltip);
    const week = /Week:\s*(\d+)%\s*\(reset za ([^,)]+)/i.exec(tooltip);

    const weekPct = week ? Number(week[1]) : raw.percentage;
    return {
      sessionPct: session ? Number(session[1]) : undefined,
      sessionReset: session?.[2]?.trim(),
      weekPct,
      weekReset: week?.[2]?.trim(),
      forecast: typeof weekPct === "number" ? forecast(weekPct) : undefined,
      available: true,
    };
  } catch {
    return { available: false };
  }
}

export async function GET(req: Request) {
  return handle(req, async () => {
    const cached = ref.__csmLimits;
    if (cached && Date.now() - cached.at < TTL_MS) return cached.data;
    const data = await readLimits();
    ref.__csmLimits = { at: Date.now(), data };
    return data;
  });
}
