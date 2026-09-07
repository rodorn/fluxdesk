"use client";

import { useMemo, useState } from "react";

import { StatusDot } from "@/components/deck/EventView";
import { SessionIcon } from "@/components/deck/SessionIcon";
import { fmtRelative } from "@/lib/format";

/** Krótkie, jednoznaczne nazwy stanów. */
const STATE_LABEL: Record<string, { text: string; color: string }> = {
  waiting: { text: "czeka na Ciebie", color: "var(--warn)" },
  "awaiting-permission": { text: "czeka na Ciebie", color: "var(--warn)" },
  working: { text: "pracuje", color: "var(--accent)" },
  running: { text: "pracuje", color: "var(--accent)" },
  starting: { text: "startuje", color: "var(--accent)" },
  idle: { text: "gotowa", color: "var(--ok)" },
  stopped: { text: "zakończona", color: "var(--muted)" },
  error: { text: "błąd", color: "var(--err)" },
  unknown: { text: "", color: "var(--muted)" },
};

/** Trzy kropki w ruchu: sesja pracuje w tej chwili. */
function Pulse() {
  return (
    <span className="flex shrink-0 items-center gap-[2px]" aria-label="pracuje">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="block h-1 w-1 rounded-full"
          style={{
            background: "var(--accent)",
            animation: "pulse 1.1s ease-in-out infinite",
            animationDelay: `${i * 0.18}s`,
          }}
        />
      ))}
    </span>
  );
}

/** Jedna pozycja listy — sesja panelu albo terminal; obie sterują tak samo. */
export type RailEntry = {
  id: string;
  kind: "sdk" | "term";
  title: string;
  cwd: string;
  status: string;
  lastAt: number;
  pending: number;
  queued: number;
  costUsd?: number;
  /** Ostatnia linia rozmowy — podgląd jak na liście czatów. */
  preview?: string;
  /** Krótki opis pod podglądem: projekt, model, zużycie kontekstu. */
  meta?: string;
  /** Liczba podagentów pracujących w tle. */
  agents?: number;
  /** Jak długo trwa bieżąca czynność. */
  elapsedSec?: number;
  /** Nazwa okna, które prowadzi tę samą rozmowę. */
  duplicateOf?: string;
  /** Jak długo sesja robi to samo, gdy wygląda na zablokowaną. */
  stuckSec?: number;
  /** Czy od ostatniego wejścia doszło coś nowego. */
  unread?: boolean;
};

export function SessionRail({
  entries,
  activeId,
  onSelect,
}: {
  entries: RailEntry[];
  activeId?: string;
  onSelect: (id: string) => void;
}) {
  const [q, setQ] = useState("");

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((e) =>
      `${e.title} ${e.cwd}`.toLowerCase().includes(needle),
    );
  }, [entries, q]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Szukaj rozmowy…"
        className="w-full rounded-lg px-2.5 py-1.5 text-xs outline-none"
        style={{
          background: "var(--panel-2)",
          border: "1px solid var(--border)",
        }}
      />

      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {shown.map((s) => {
          const active = s.id === activeId;
          const waiting = s.pending > 0;
          const index = entries.indexOf(s);
          return (
            <li key={s.id}>
              <button
                onClick={() => onSelect(s.id)}
                title={`${s.title}\n${s.preview ?? ''}\n${s.cwd}`}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left"
                style={{
                  background: active ? "var(--accent-soft)" : "transparent",
                  border: `1px solid ${
                    waiting
                      ? "var(--warn)"
                      : active
                        ? "var(--accent)"
                        : "transparent"
                  }`,
                }}
              >
                <SessionIcon
                  title={s.title}
                  cwd={s.cwd}
                  terminal={s.kind === "term"}
                />

                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5">
                    <span
                      className="min-w-0 flex-1 truncate text-xs"
                      style={{ fontWeight: s.unread || waiting ? 600 : 400 }}
                    >
                      {s.title}
                    </span>
                    {s.stuckSec ? (
                      <span
                        className="shrink-0 rounded px-1 text-[9px] font-semibold"
                        style={{ background: "var(--err)", color: "#fff" }}
                        title={`Ta sama czynność od ${Math.round(s.stuckSec / 60)} minut`}
                      >
                        utknęła
                      </span>
                    ) : null}
                    {s.duplicateOf ? (
                      <span
                        className="shrink-0 rounded px-1 text-[9px] font-semibold"
                        style={{ background: "var(--warn)", color: "#000" }}
                        title={`Ta sama rozmowa jest otwarta w oknie „${s.duplicateOf}”`}
                      >
                        duplikat
                      </span>
                    ) : null}
                    <span className="shrink-0 text-[10px] muted">
                      {fmtRelative(s.lastAt)}
                    </span>
                  </span>

                  <span className="flex items-center gap-1.5">
                    <StatusDot status={s.status} label={false} />
                    {STATE_LABEL[s.status]?.text ? (
                      <span
                        className="shrink-0 text-[10px] font-medium"
                        style={{ color: STATE_LABEL[s.status].color }}
                      >
                        {STATE_LABEL[s.status].text}
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1 truncate text-[10px] muted">
                      {s.preview ?? s.cwd}
                    </span>
                    {s.queued ? (
                      <span className="shrink-0 text-[10px] muted">
                        +{s.queued}
                      </span>
                    ) : null}
                    {waiting ? (
                      <span
                        className="shrink-0 rounded-full px-1.5 text-[10px] font-semibold"
                        style={{ background: "var(--warn)", color: "#000" }}
                      >
                        {s.pending}
                      </span>
                    ) : s.status === "working" ? (
                      <Pulse />
                    ) : s.unread ? (
                      <span
                        className="shrink-0 rounded px-1 text-[9px] font-semibold uppercase"
                        style={{ background: "var(--ok)", color: "#04180f" }}
                      >
                        nowe
                      </span>
                    ) : index < 9 ? (
                      <span className="shrink-0 text-[10px] mono muted">
                        {index + 1}
                      </span>
                    ) : null}
                  </span>

                  {s.meta || s.elapsedSec || s.agents || s.costUsd ? (
                    <span className="flex items-center gap-2 text-[10px] mono muted opacity-70">
                      {s.elapsedSec ? (
                        <span style={{ color: "var(--accent)" }}>
                          {s.elapsedSec < 60
                            ? `${s.elapsedSec}s`
                            : `${Math.floor(s.elapsedSec / 60)}m ${s.elapsedSec % 60}s`}
                        </span>
                      ) : null}
                      <span className="min-w-0 flex-1 truncate">{s.meta}</span>
                      {s.costUsd ? (
                        <span className="shrink-0 tabular-nums">
                          {s.costUsd < 0.01 ? '<0,01' : s.costUsd.toFixed(2)} USD
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
        {shown.length === 0 ? (
          <li className="py-6 text-center text-xs muted">Nic nie pasuje.</li>
        ) : null}
      </ul>
    </div>
  );
}
