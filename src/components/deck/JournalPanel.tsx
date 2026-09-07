"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui";
import { fmtTokens, fmtUsd } from "@/lib/format";

type Journal = {
  date: string;
  entries: {
    sessionId: string;
    title: string;
    project: string;
    lastSeen: number;
    messageCount: number;
    tokens: number;
    costUsd: number;
    activeMs?: number;
  }[];
  byProject: {
    project: string;
    sessions: number;
    tokens: number;
    costUsd: number;
  }[];
  doneTasks: { description: string; project?: string }[];
  totals: {
    sessions: number;
    tokens: number;
    costUsd: number;
    activeMs: number;
  };
  /** Najdroższe rozmowy dnia — zwykle jedna zjada większość budżetu. */
  topCost: {
    sessionId: string;
    title: string;
    project: string;
    costUsd: number;
  }[];
  usdPln: number;
};

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function duration(ms: number): string {
  if (!ms) return "—";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Co się dziś działo: sesje, projekty i zamknięte zadania w jednym miejscu. */
export function JournalPanel() {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [data, setData] = useState<Journal>();
  const [week, setWeek] = useState<{
    days: { date: string; sessions: number; tokens: number; costUsd: number }[];
    byProject: { project: string; tokens: number; costUsd: number }[];
    usdPln: number;
  }>();
  const [showWeek, setShowWeek] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (day: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/journal?date=${day}`);
      if (res.ok) setData((await res.json()) as Journal);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(date);
  }, [date, load]);

  function copy() {
    if (!data) return;
    const lines = [
      `Status ${data.date}`,
      "",
      "Co zrobione:",
      ...data.doneTasks.map((t) => `- ${t.description}`),
      data.doneTasks.length ? "" : "- (nic nie zamknięte)",
      "",
      "Nad czym pracowałem:",
      ...data.entries.slice(0, 6).map((e) => `- ${e.title} (${e.project})`),
      "",
      "Projekty:",
      ...data.byProject.map(
        (p) =>
          `${p.project}: ${p.sessions} sesji, ${fmtTokens(p.tokens)} tokenów`,
      ),
      "",
      ...(data.doneTasks.length
        ? [
            "Zamknięte zadania:",
            ...data.doneTasks.map((t) => `- ${t.description}`),
          ]
        : []),
    ];
    navigator.clipboard?.writeText(lines.join("\n"));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setDate(shiftDate(date, -1))}>
          ‹ poprzedni
        </Button>
        <span className="text-sm font-medium">{date}</span>
        <Button
          onClick={() => setDate(shiftDate(date, 1))}
          disabled={date >= today}
        >
          następny ›
        </Button>
        {date !== today ? (
          <Button onClick={() => setDate(today)}>dziś</Button>
        ) : null}
        <span className="flex-1" />
        <Button
          onClick={() => {
            setShowWeek((v) => !v);
            if (!week) {
              fetch("/api/journal?range=week")
                .then((r) => (r.ok ? r.json() : undefined))
                .then((d) => d && setWeek(d))
      .catch(() => undefined);
            }
          }}
        >
          {showWeek ? "Dzień" : "Tydzień"}
        </Button>
        <Button
          onClick={async () => {
            const res = await fetch("/api/journal?range=billing&days=30");
            if (!res.ok) return;
            const b = (await res.json()) as {
              from: string;
              to: string;
              usdPln: number;
              rows: { project: string; sessions: number; taskMin: number; costUsd: number }[];
            };
            const lines = [
              `Raport ${b.from} do ${b.to}`,
              "",
              ...b.rows.map(
                (r) =>
                  `${r.project}: ${r.sessions} sesji, ${Math.round(r.taskMin / 60)} h pracy, ` +
                  `${Math.round(r.costUsd * b.usdPln)} zł kosztu modeli`,
              ),
            ];
            navigator.clipboard?.writeText(lines.join("\n"));
          }}
          disabled={!data}
          title="Zestawienie miesięczne na projekt, do wyceny albo faktury"
        >
          Raport miesięczny
        </Button>
        <Button onClick={copy} disabled={!data}>
          Kopiuj na status
        </Button>
      </div>

      {loading && !data ? (
        <p className="py-8 text-center text-sm muted">Liczę…</p>
      ) : null}

      {showWeek && week ? (
        <div className="space-y-2">
          <div className="text-[10px] font-semibold muted">OSTATNIE SIEDEM DNI</div>
          {week.days.map((d) => {
            const max = Math.max(...week.days.map((x) => x.tokens), 1);
            return (
              <div key={d.date} className="flex items-center gap-2 text-[11px]">
                <span className="w-20 shrink-0 mono muted">{d.date.slice(5)}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: "var(--panel-2)" }}>
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${(d.tokens / max) * 100}%`, background: "var(--accent)" }}
                  />
                </span>
                <span className="w-16 shrink-0 text-right tabular-nums muted">{d.sessions} sesji</span>
                <span className="w-20 shrink-0 text-right tabular-nums">
                  {Math.round(d.costUsd * week.usdPln)} zł
                </span>
              </div>
            );
          })}
          <div className="pt-2 text-[10px] font-semibold muted">PROJEKTY W TYGODNIU</div>
          {week.byProject.slice(0, 8).map((p) => (
            <div key={p.project} className="flex items-center gap-2 text-[11px]">
              <span className="min-w-0 flex-1 truncate">{p.project}</span>
              <span className="tabular-nums muted">{Math.round(p.costUsd * week.usdPln)} zł</span>
            </div>
          ))}
        </div>
      ) : null}

      {data && !showWeek ? (
        <>
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "Sesje", value: String(data.totals.sessions) },
              { label: "Tokeny", value: fmtTokens(data.totals.tokens) },
              {
                label: "Wg cennika",
                value: `${Math.round(data.totals.costUsd * data.usdPln)} zł`,
              },
              { label: "Czas w panelu", value: duration(data.totals.activeMs) },
            ].map((t) => (
              <div
                key={t.label}
                className="rounded-lg px-2.5 py-2"
                style={{ background: "var(--panel-2)" }}
              >
                <div className="text-[10px] muted">{t.label}</div>
                <div className="text-sm font-semibold tabular-nums">
                  {t.value}
                </div>
              </div>
            ))}
          </div>

          {data.topCost?.length ? (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold muted">NAJDROŻSZE ROZMOWY</div>
              {data.topCost.map((e) => (
                <div key={e.sessionId} className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate">{e.title}</span>
                  <span className="muted">{e.project}</span>
                  <span className="tabular-nums" style={{ color: 'var(--warn)' }}>
                    {Math.round(e.costUsd * data.usdPln)} zł
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {data.byProject.length ? (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold muted">PROJEKTY</div>
              {data.byProject.map((p) => (
                <div
                  key={p.project}
                  className="flex items-center gap-2 text-xs"
                >
                  <span className="min-w-0 flex-1 truncate">{p.project}</span>
                  <span className="muted">{p.sessions} sesji</span>
                  <span className="tabular-nums muted">
                    {fmtTokens(p.tokens)}
                  </span>
                  <span className="tabular-nums muted">
                    {Math.round(p.costUsd * data.usdPln)} zł
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {data.doneTasks.length ? (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold muted">
                ZAMKNIĘTE ZADANIA
              </div>
              {data.doneTasks.map((t, i) => (
                <div key={i} className="flex gap-2 text-xs">
                  <span style={{ color: "var(--ok)" }}>✓</span>
                  <span className="min-w-0 flex-1">{t.description}</span>
                  {t.project ? (
                    <span className="muted">{t.project}</span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          <div className="space-y-1">
            <div className="text-[10px] font-semibold muted">SESJE</div>
            <div className="max-h-[35vh] space-y-1 overflow-y-auto pr-1">
              {data.entries.map((e) => (
                <div
                  key={e.sessionId}
                  className="rounded-lg px-2.5 py-1.5"
                  style={{ background: "var(--panel-2)" }}
                >
                  <div className="truncate text-xs">{e.title}</div>
                  <div className="flex flex-wrap gap-x-2 text-[10px] muted">
                    <span>{e.project}</span>
                    <span>
                      {new Date(e.lastSeen).toLocaleTimeString("pl-PL")}
                    </span>
                    <span>{e.messageCount} wiad.</span>
                    <span className="tabular-nums">{fmtTokens(e.tokens)}</span>
                    {e.activeMs ? <span>{duration(e.activeMs)}</span> : null}
                  </div>
                </div>
              ))}
              {data.entries.length === 0 ? (
                <p className="py-6 text-center text-xs muted">
                  Tego dnia nic się nie działo.
                </p>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
