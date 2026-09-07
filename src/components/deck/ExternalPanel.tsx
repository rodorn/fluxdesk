"use client";

import { useState } from "react";

import { Button } from "@/components/ui";
import { fmtRelative, shortenPath } from "@/lib/format";
import type { ExternalSession } from "@/lib/processes";

function mb(bytes: number): string {
  return `${Math.round(bytes / 1048576)} MB`;
}

/**
 * Sesje `claude` uruchomione poza panelem — te z pootwieranych okien terminala.
 * Panel nie przejmie ich TTY, ale pokazuje, ile ich jest, ile pamięci zjadają
 * i pozwala je zamknąć albo wznowić ich pracę u siebie.
 */
export function ExternalPanel({
  items,
  onKill,
  onResume,
  onAdoptAll,
}: {
  items: ExternalSession[];
  onKill: (pid: number) => void;
  onResume: (session: ExternalSession) => void;
  onAdoptAll: (sessions: ExternalSession[]) => void;
}) {
  const [open, setOpen] = useState(true);
  if (!items.length) return null;

  const totalRss = items.reduce((sum, p) => sum + p.rss, 0);
  const stale = items.filter(
    (p) => p.startedAt && Date.now() - p.startedAt > 7 * 86_400_000,
  );

  return (
    <div
      className="rounded-lg"
      style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left"
      >
        <span className="text-[11px] font-medium">
          Poza panelem: {items.length}
          <span className="muted"> · {mb(totalRss)}</span>
        </span>
        <span className="text-[10px] muted">{open ? "▾" : "▸"}</span>
      </button>

      {open ? (
        <div className="max-h-64 space-y-1 overflow-y-auto px-2 pb-2">
          {stale.length ? (
            <p className="px-0.5 text-[10px]" style={{ color: "var(--warn)" }}>
              {stale.length} starszych niż tydzień — pewnie zapomniane okna.
            </p>
          ) : null}
          {items.map((p) => (
            <div
              key={p.pid}
              className="rounded px-2 py-1.5"
              style={{ background: "var(--panel-2)" }}
            >
              <div className="flex items-start justify-between gap-2">
                <span
                  className="min-w-0 flex-1 truncate text-[11px] font-medium"
                  title={p.title}
                >
                  {p.title ?? shortenPath(p.cwd, 2)}
                  {p.match === "guess" ? (
                    <span
                      className="ml-1 text-[9px] muted"
                      title="dopasowanie przybliżone"
                    >
                      ?
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[10px] muted">{mb(p.rss)}</span>
              </div>
              <div className="truncate text-[10px] muted mono">
                {shortenPath(p.cwd, 2)}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] muted">
                  pid {p.pid} ·{" "}
                  {p.startedAt ? fmtRelative(p.startedAt) : "nieznany start"}
                </span>
                <span className="flex gap-1">
                  {p.cwd ? (
                    <button
                      onClick={() => onResume(p)}
                      className="text-[10px] underline"
                      title={
                        p.sessionId
                          ? "Wznów tę rozmowę w panelu"
                          : "Otwórz terminal w tym katalogu"
                      }
                    >
                      przejmij
                    </button>
                  ) : null}
                  <button
                    onClick={() => {
                      if (confirm(`Zamknąć proces ${p.pid} (${p.cwd ?? "?"})?`))
                        onKill(p.pid);
                    }}
                    className="text-[10px] underline"
                    style={{ color: "var(--err)" }}
                  >
                    zamknij
                  </button>
                </span>
              </div>
            </div>
          ))}
          <Button
            className="w-full"
            onClick={() => {
              const adoptable = items.filter((p) => p.sessionId);
              if (!adoptable.length) return;
              if (
                confirm(
                  `Przejąć ${adoptable.length} rozmów? Każda otworzy w panelu terminal wznawiający ją (--resume). Stare procesy zostaną nietknięte — zamkniesz je osobno.`,
                )
              ) {
                onAdoptAll(adoptable);
              }
            }}
            disabled={!items.some((p) => p.sessionId)}
          >
            Przejmij wszystkie ({items.filter((p) => p.sessionId).length})
          </Button>
          <Button
            variant="danger"
            className="w-full"
            onClick={() => {
              const old = stale.map((p) => p.pid);
              if (!old.length) return;
              if (
                confirm(`Zamknąć ${old.length} procesów starszych niż tydzień?`)
              ) {
                old.forEach(onKill);
              }
            }}
            disabled={!stale.length}
          >
            Zamknij {stale.length} zapomnianych
          </Button>
        </div>
      ) : null}
    </div>
  );
}
