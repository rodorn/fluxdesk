"use client";

import { useEffect, useState } from "react";

import { fmtRelative } from "@/lib/format";

type Project = {
  name: string;
  path: string;
  branch?: string;
  dirtyFiles: number;
  lastCommit?: string;
  hasClaudeMd: boolean;
  sessions: number;
  lastSession: number;
  openTasks: number;
  doneTasks: number;
};

/**
 * Karty projektów. Ta sama wiedza była wcześniej rozsypana po sesjach,
 * zadaniach i repozytoriach; tutaj widać stan każdego projektu na raz.
 */
export function ProjectsPanel({ onOpen }: { onOpen?: (cwd: string) => void }) {
  const [items, setItems] = useState<Project[]>();

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => (r.ok ? r.json() : undefined))
      .then((d) => d && setItems(d.items as Project[]))
      .catch(() => undefined);
  }, []);

  if (!items) return <p className="py-8 text-center text-sm muted">Zbieram…</p>;

  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {items.map((p) => (
        <div
          key={p.path}
          className="flex flex-col gap-1.5 rounded-lg px-3 py-2.5"
          style={{ background: "var(--panel-2)" }}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-xs font-semibold">{p.name}</span>
            {p.branch ? (
              <span className="shrink-0 text-[10px] mono muted">
                {p.branch}
              </span>
            ) : null}
          </div>

          {p.lastCommit ? (
            <div className="truncate text-[10px] muted">{p.lastCommit}</div>
          ) : null}

          <div className="flex flex-wrap gap-x-3 text-[10px] muted">
            <span>{p.sessions} sesji</span>
            {p.lastSession ? <span>{fmtRelative(p.lastSession)}</span> : null}
            {p.openTasks ? (
              <span style={{ color: "var(--accent)" }}>
                {p.openTasks} zadań
              </span>
            ) : null}
            {p.dirtyFiles ? (
              <span
                style={{ color: p.dirtyFiles > 50 ? "var(--warn)" : undefined }}
              >
                {p.dirtyFiles} zmian
              </span>
            ) : null}
            {!p.hasClaudeMd ? (
              <span title="Brak CLAUDE.md">bez instrukcji</span>
            ) : null}
          </div>

          {onOpen ? (
            <button
              onClick={() => onOpen(p.path)}
              className="self-start text-[10px] underline muted"
            >
              otwórz sesję
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
