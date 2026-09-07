"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui";

type Report = {
  date: string;
  switches: number;
  activeMin: number;
  longestStreakMin: number;
  goal?: string;
  goalDone?: boolean;
  quietNow: boolean;
  eveningNow: boolean;
  settings: {
    breakAfterMin: number;
    eveningFrom: number;
    quietFrom: number;
    quietTo: number;
  };
  history: { date: string; switches: number; activeMin: number }[];
};

function hhmm(min: number): string {
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

/**
 * Uwaga i rytm dnia. Twoje własne notatki mówią o rozpraszaniu i niewykorzystanym
 * czasie; panel jako jedyny widzi, kiedy naprawdę pracujesz i jak często
 * przeskakujesz między rozmowami.
 */
export function AttentionPanel() {
  const [data, setData] = useState<Report>();
  const [goal, setGoal] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/attention");
    if (!res.ok) return;
    const d = (await res.json()) as Report;
    setData(d);
    setGoal(d.goal ?? "");
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  async function send(body: Record<string, unknown>) {
    await fetch("/api/attention", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    load();
  }

  if (!data) return <p className="py-8 text-center text-sm muted">Liczę…</p>;

  const maxActive = Math.max(...data.history.map((h) => h.activeMin), 1);
  const needsBreak = data.longestStreakMin >= data.settings.breakAfterMin;

  return (
    <div className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send({ action: "goal", goal });
        }}
        className="flex gap-2"
      >
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Cel na dziś, jedno zdanie…"
          className="min-w-0 flex-1 rounded-lg px-3 py-1.5 text-sm outline-none"
          style={{
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            textDecoration: data.goalDone ? "line-through" : undefined,
          }}
        />
        <Button type="submit">Zapisz</Button>
        {data.goal ? (
          <Button
            variant={data.goalDone ? "ghost" : "primary"}
            onClick={() => send({ action: "goal", done: !data.goalDone })}
          >
            {data.goalDone ? "Cofnij" : "Osiągnięty"}
          </Button>
        ) : null}
      </form>

      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "przy pracy dziś", value: hhmm(data.activeMin) },
          { label: "najdłuższy ciąg", value: hhmm(data.longestStreakMin) },
          { label: "przeskoków", value: String(data.switches) },
        ].map((t) => (
          <div
            key={t.label}
            className="rounded-lg px-2.5 py-2"
            style={{ background: "var(--panel-2)" }}
          >
            <div className="text-[10px] muted">{t.label}</div>
            <div className="text-sm font-semibold tabular-nums">{t.value}</div>
          </div>
        ))}
      </div>

      {needsBreak ? (
        <div
          className="rounded-lg px-3 py-1.5 text-xs"
          style={{
            background: "var(--panel)",
            border: "1px solid var(--warn)",
            color: "var(--warn)",
          }}
        >
          {hhmm(data.longestStreakMin)} bez przerwy. Wstań na chwilę.
        </div>
      ) : null}

      {data.eveningNow ? (
        <div
          className="rounded-lg px-3 py-1.5 text-xs muted"
          style={{ background: "var(--panel-2)" }}
        >
          Po {data.settings.eveningFrom}. Zaczynanie nowych rzeczy o tej porze
          zwykle kończy się niedokończoną robotą na rano.
        </div>
      ) : null}

      <div className="space-y-1">
        <div className="text-[10px] font-semibold muted">
          OSTATNIE DNI {data.quietNow ? "· ciche godziny trwają" : ""}
        </div>
        {data.history.map((h) => (
          <div key={h.date} className="flex items-center gap-2 text-[11px]">
            <span className="w-14 shrink-0 mono muted">{h.date.slice(5)}</span>
            <span
              className="h-2 flex-1 overflow-hidden rounded-full"
              style={{ background: "var(--panel-2)" }}
            >
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${(h.activeMin / maxActive) * 100}%`,
                  background: "var(--ok)",
                }}
              />
            </span>
            <span className="w-16 shrink-0 text-right tabular-nums muted">
              {hhmm(h.activeMin)}
            </span>
            <span className="w-20 shrink-0 text-right tabular-nums muted">
              {h.switches} przeskoków
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
