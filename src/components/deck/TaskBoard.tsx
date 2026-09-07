"use client";

import { useCallback, useEffect, useState } from "react";

type Status =
  | "to_do"
  | "in_progress"
  | "do_poprawy"
  | "zlecone"
  | "testowanie"
  | "feedback"
  | "zrobione";

type Task = {
  id: string;
  title: string;
  notes?: string;
  project?: string;
  tags: string[];
  status: Status;
  priority: 0 | 1 | 2;
  due?: string;
  assignedTo?: string;
  timeSpentMs: number;
  startedAt?: number;
};

const COLUMNS: { id: Status; label: string; color: string }[] = [
  { id: "to_do", label: "do zrobienia", color: "var(--muted)" },
  { id: "in_progress", label: "w trakcie", color: "var(--accent)" },
  { id: "do_poprawy", label: "do poprawy", color: "var(--err)" },
  { id: "zlecone", label: "zlecone", color: "#0ea5e9" },
  { id: "testowanie", label: "testowanie", color: "var(--warn)" },
  { id: "feedback", label: "feedback", color: "#d946ef" },
  { id: "zrobione", label: "zrobione", color: "var(--ok)" },
];

/**
 * Tablica zadań. Siedem statusów czyta się z kolumn znacznie szybciej niż
 * z listy, a przeciąganie karty jest krótsze niż wybieranie z rozwijanej listy.
 */
/** Ile kart pokazujemy w kolumnie; reszta czeka pod przyciskiem. */
const PER_COLUMN = 25;

export function TaskBoard({ tag }: { tag?: string }) {
  const [items, setItems] = useState<Task[]>([]);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [filter, setFilter] = useState<string | undefined>(tag);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [dragging, setDragging] = useState<string>();

  const load = useCallback(async () => {
    const params = new URLSearchParams({ group: "all" });
    if (filter) params.set("tag", filter);
    if (q.trim()) params.set("q", q.trim());
    const res = await fetch(`/api/todo?${params}`);
    if (!res.ok) return;
    const data = (await res.json()) as {
      items: Task[];
      tags: { tag: string; count: number }[];
    };
    setItems(data.items);
    setTags(data.tags);
  }, [filter, q]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function move(id: string, status: Status) {
    setItems((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
    await fetch("/api/todo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", id, patch: { status } }),
    });
    load();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        <button
          onClick={() => setFilter(undefined)}
          className="rounded-lg px-2 py-0.5 text-[10px]"
          style={{
            background: filter ? "var(--panel-2)" : "var(--accent)",
            color: filter ? "var(--text)" : "#fff",
          }}
        >
          wszystkie {items.length}
        </button>
        {tags.slice(0, 10).map((t) => (
          <button
            key={t.tag}
            onClick={() => setFilter(t.tag)}
            className="rounded-lg px-2 py-0.5 text-[10px]"
            style={{
              background: filter === t.tag ? "var(--accent)" : "var(--panel-2)",
              color: filter === t.tag ? "#fff" : "var(--text)",
            }}
          >
            #{t.tag} <span className="opacity-60">{t.count}</span>
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Szukaj…"
          className="ml-auto w-36 rounded-lg px-2 py-0.5 text-[10px] outline-none"
          style={{ background: "var(--panel-2)", border: "1px solid var(--border)" }}
        />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2">
      {COLUMNS.map((col) => {
        const cards = items.filter((t) => t.status === col.id);
        return (
          <div
            key={col.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragging) move(dragging, col.id);
              setDragging(undefined);
            }}
            className="flex w-56 shrink-0 flex-col rounded-lg"
            style={{ background: "var(--panel-2)" }}
          >
            <div
              className="flex items-center justify-between px-2.5 py-1.5 text-[11px] font-semibold"
              style={{
                color: col.color,
                borderBottom: `2px solid ${col.color}`,
              }}
            >
              <span>{col.label}</span>
              <span className="opacity-60">{cards.length}</span>
            </div>

            <div className="max-h-[52vh] min-h-[6rem] space-y-1 overflow-y-auto p-1.5">
              {(expanded[col.id] ? cards : cards.slice(0, PER_COLUMN)).map((t) => (
                <div
                  key={t.id}
                  draggable
                  onDragStart={() => setDragging(t.id)}
                  onDragEnd={() => setDragging(undefined)}
                  className="cursor-grab rounded px-2 py-1.5 active:cursor-grabbing"
                  style={{
                    background: "var(--panel)",
                    borderLeft: `2px solid ${
                      t.priority === 2
                        ? "var(--err)"
                        : t.priority === 1
                          ? "var(--warn)"
                          : "transparent"
                    }`,
                    opacity: dragging === t.id ? 0.4 : 1,
                  }}
                  title={t.notes}
                >
                  <div className="text-[11px] leading-snug">{t.title}</div>
                  {t.tags.length || t.assignedTo ? (
                    <div className="mt-0.5 flex flex-wrap gap-x-1.5 text-[9px] muted">
                      {t.tags.slice(1).map((tag) => (
                        <span key={tag} style={{ color: "var(--accent)" }}>
                          #{tag}
                        </span>
                      ))}
                      {t.assignedTo ? <span>@{t.assignedTo}</span> : null}
                    </div>
                  ) : null}
                </div>
              ))}
              {cards.length > PER_COLUMN && !expanded[col.id] ? (
                <button
                  onClick={() => setExpanded((e) => ({ ...e, [col.id]: true }))}
                  className="w-full rounded px-2 py-1 text-[10px] muted"
                  style={{ background: "var(--panel)" }}
                >
                  pokaż pozostałe {cards.length - PER_COLUMN}
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}
