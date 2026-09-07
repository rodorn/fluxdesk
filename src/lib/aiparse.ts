import { promises as fs } from "node:fs";
import path from "node:path";

import { listSecrets, revealSecret } from "./secrets";
import { dataDir } from "./store";
import type { QuickBlock } from "./quickparse";

/**
 * Rozumienie zdania przez model przez wywołanie narzędzia o ustalonym
 * kształcie. Idziemy prosto do API zamiast przez proces CLI, bo tam sam start
 * zajmował kilkanaście sekund, a tu odpowiedź wraca w około sekundę.
 *
 * Podział obowiązków: daty i godziny liczy kod (jest w tym dokładny), model
 * odpowiada tylko za to, czego kod nie wie, czyli ile taka sprawa trwa.
 */

export type AiBlock = QuickBlock & {
  estimated: boolean;
  reason?: string;
};

const MODEL = "claude-haiku-4-5-20251001";

/** Klucz bierzemy z sejfu panelu; nazwa może być dowolna, byle kończyła się tak. */
async function apiKey(): Promise<string | undefined> {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const named = (await listSecrets()).find((s) =>
      /(^|\/)ANTHROPIC_API_KEY$/.test(s.name),
    );
    if (!named) return undefined;
    return await revealSecret(named.name);
  } catch {
    return undefined;
  }
}

type ToolResult = Record<string, unknown> | undefined;

async function callTool(
  key: string,
  prompt: string,
  toolName: string,
  schema: Record<string, unknown>,
  description: string,
): Promise<ToolResult> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      // Wymuszamy narzędzie: model nie ma jak odpowiedzieć zdaniem obok tematu.
      tool_choice: { type: "tool", name: toolName },
      tools: [{ name: toolName, description, input_schema: schema }],
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return undefined;

  const data = (await res.json()) as {
    content?: { type: string; input?: Record<string, unknown> }[];
  };
  return data.content?.find((c) => c.type === "tool_use")?.input;
}

/* ------------------------------------------------------------------ */
/* Szacowanie długości                                                 */
/* ------------------------------------------------------------------ */

type Estimates = Record<string, { minutes: number; reason: string }>;

function estimatesFile(): string {
  return path.join(dataDir(), "calendar-estimates.json");
}

async function readEstimates(): Promise<Estimates> {
  try {
    return JSON.parse(await fs.readFile(estimatesFile(), "utf8")) as Estimates;
  } catch {
    return {};
  }
}

async function rememberEstimate(
  key: string,
  minutes: number,
  reason: string,
): Promise<void> {
  const all = await readEstimates();
  all[key] = { minutes, reason };
  await fs
    .writeFile(estimatesFile(), JSON.stringify(all, null, 2))
    .catch(() => undefined);
}

/**
 * Ile trwa sprawa o takiej nazwie. Raz odgadnięta długość ląduje w pliku, więc
 * drugi „dentysta" nie czeka już na model ani nie kosztuje.
 */
export async function estimateMinutes(
  title: string,
): Promise<{ minutes: number; reason: string } | undefined> {
  const key = title.trim().toLowerCase();
  if (!key) return undefined;

  const known = (await readEstimates())[key];
  if (known) return known;

  const key$ = await apiKey();
  if (!key$) return undefined;

  const input = await callTool(
    key$,
    `Ile minut zwykle zajmuje: "${title}"? Odpowiedz wywołaniem narzędzia.`,
    "dlugosc",
    {
      type: "object",
      properties: {
        durationMin: {
          type: "integer",
          minimum: 5,
          maximum: 720,
          description: "Typowa długość w minutach",
        },
        reason: {
          type: "string",
          description: "Krótkie uzasadnienie po polsku, kilka słów",
        },
      },
      required: ["durationMin", "reason"],
    },
    "Podaje typową długość sprawy w minutach.",
  ).catch(() => undefined);

  const minutes = Number(input?.durationMin);
  if (!minutes || Number.isNaN(minutes)) return undefined;

  const reason = String(input?.reason ?? "");
  void rememberEstimate(key, minutes, reason);
  return { minutes, reason };
}

/* ------------------------------------------------------------------ */
/* Pełne rozpoznanie zdania                                            */
/* ------------------------------------------------------------------ */

/** Nazwy dni z konkretnymi datami, żeby model nie liczył kalendarza z głowy. */
function upcomingDays(now: number): string {
  const names = [
    "niedziela",
    "poniedziałek",
    "wtorek",
    "środa",
    "czwartek",
    "piątek",
    "sobota",
  ];
  const out: string[] = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now + i * 86_400_000);
    out.push(
      `najbliższa ${names[d.getDay()]} to ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    );
  }
  return out.join(", ");
}

export async function parseWithAi(
  text: string,
  now = Date.now(),
): Promise<AiBlock | undefined> {
  const key = await apiKey();
  if (!key) return undefined;

  const local = new Date(now);
  const prompt = [
    `Dzisiaj: ${local.toISOString().slice(0, 16)} czasu lokalnego.`,
    `${upcomingDays(now)}.`,
    `Użytkownik napisał: "${text}".`,
    "Ustal nazwę, początek i długość, i wywołaj narzędzie.",
    "Użyj dat podanych wyżej, nie licz ich sam.",
    "Jeśli długości nie ma w tekście, oszacuj ją i ustaw estimated na true.",
  ].join(" ");

  const input = await callTool(
    key,
    prompt,
    "zaplanuj",
    {
      type: "object",
      properties: {
        title: { type: "string", description: "Krótka nazwa po polsku" },
        start: {
          type: "string",
          description: "Początek jako 2026-09-09T16:00, czas lokalny",
        },
        durationMin: { type: "integer", minimum: 5, maximum: 720 },
        estimated: {
          type: "boolean",
          description: "Czy długość to Twój szacunek",
        },
        reason: { type: "string", description: "Kilka słów, skąd ta długość" },
      },
      required: ["title", "start", "durationMin", "estimated", "reason"],
    },
    "Zapisuje zrozumiany termin.",
  ).catch(() => undefined);

  if (!input) return undefined;
  const start = Date.parse(String(input.start));
  const minutes = Number(input.durationMin);
  if (Number.isNaN(start) || !minutes) return undefined;

  return {
    title: String(input.title),
    start,
    end: start + minutes * 60_000,
    estimated: Boolean(input.estimated),
    reason: input.reason ? String(input.reason) : undefined,
  };
}
