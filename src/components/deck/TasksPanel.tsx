"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui";

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
  sessionIds: string[];
};

/** Kolejność jak w przepływie pracy; cyfra to zarazem skrót do zmiany statusu. */
const STATUSES: { id: Status; label: string; color: string }[] = [
  { id: "to_do", label: "do zrobienia", color: "var(--muted)" },
  { id: "in_progress", label: "w trakcie", color: "var(--accent)" },
  { id: "do_poprawy", label: "do poprawy", color: "var(--err)" },
  { id: "zlecone", label: "zlecone", color: "#0ea5e9" },
  { id: "testowanie", label: "testowanie", color: "var(--warn)" },
  { id: "feedback", label: "feedback", color: "#d946ef" },
  { id: "zrobione", label: "zrobione", color: "var(--ok)" },
];

const GROUPS: { id: "open" | "completed" | "closed" | "all"; label: string }[] =
  [
    { id: "open", label: "otwarte" },
    { id: "completed", label: "po robocie" },
    { id: "closed", label: "zamknięte" },
    { id: "all", label: "wszystkie" },
  ];

function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function dueInfo(due?: string): { text: string; overdue: boolean } | undefined {
  if (!due) return undefined;
  const date = new Date(due);
  if (Number.isNaN(date.getTime())) return undefined;
  const days = Math.round((date.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { text: `${-days} dni po terminie`, overdue: true };
  if (days === 0) return { text: "dziś", overdue: true };
  if (days === 1) return { text: "jutro", overdue: false };
  if (days < 14) return { text: `za ${days} dni`, overdue: false };
  return { text: date.toLocaleDateString("pl-PL"), overdue: false };
}

/**
 * Rozbiór jednej linijki: „napraw import #projekt @osoba !! za 3d”.
 * Pisanie zadania ma być szybsze niż wypełnianie formularza.
 */
function parseInput(raw: string): {
  title: string;
  tags: string[];
  project?: string;
  assignedTo?: string;
  priority: 0 | 1 | 2;
  repeatDays?: number;
  estimateMin?: number;
  due?: string;
} {
  const tags = [...raw.matchAll(/#(\S+)/g)].map((m) => m[1]);
  const assignedTo = /@(\S+)/.exec(raw)?.[1];
  const priority: 0 | 1 | 2 = /!!/.test(raw) ? 2 : /!/.test(raw) ? 1 : 0;

  // „co 7d” powtarza zadanie, „~30m” szacuje czas, „za 3d” ustawia termin.
  const repeat = /\bco\s+(\d+)\s*d\b/i.exec(raw);
  const estimate = /~\s*(\d+)\s*(m|min|h)\b/i.exec(raw);
  const dueIn = /\bza\s+(\d+)\s*d\b/i.exec(raw);

  const title = raw
    .replace(/#\S+/g, "")
    .replace(/@\S+/g, "")
    .replace(/!+/g, "")
    .replace(/\bco\s+\d+\s*d\b/gi, "")
    .replace(/~\s*\d+\s*(m|min|h)\b/gi, "")
    .replace(/\bza\s+\d+\s*d\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    title,
    tags,
    project: tags[0],
    assignedTo,
    priority,
    repeatDays: repeat ? Number(repeat[1]) : undefined,
    estimateMin: estimate
      ? Number(estimate[1]) * (estimate[2].toLowerCase() === "h" ? 60 : 1)
      : undefined,
    due: dueIn
      ? new Date(Date.now() + Number(dueIn[1]) * 86_400_000).toISOString()
      : undefined,
  };
}

/**
 * Zadania Fluxdesk. Statusy odzwierciedlają realny przepływ: praca kończy się
 * wejściem w testowanie albo feedback, a zamyka dopiero jako „zrobione”.
 * Wszystko da się zrobić z klawiatury, bez sięgania po mysz.
 */
export function TasksPanel({
  sessionId,
  onUseAsPrompt,
}: {
  sessionId?: string;
  onUseAsPrompt?: (text: string) => void;
}) {
  const [items, setItems] = useState<Task[]>([]);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [group, setGroup] = useState<"open" | "completed" | "closed" | "all">(
    "open",
  );
  const [tagFilter, setTagFilter] = useState<string>();
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState("");
  const [cursor, setCursor] = useState(0);
  /** Plan dnia: trzy rzeczy zamiast stu osiemdziesięciu. */
  const [planOnly, setPlanOnly] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ group });
    if (tagFilter) params.set("tag", tagFilter);
    if (q.trim()) params.set("q", q.trim());
    const res = await fetch(`/api/todo?${params}`);
    if (!res.ok) return;
    const data = (await res.json()) as {
      items: Task[];
      tags: { tag: string; count: number }[];
    };
    setItems(data.items);
    setTags(data.tags);
  }, [group, tagFilter, q]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load]);

  const act = useCallback(
    async (body: Record<string, unknown>) => {
      await fetch("/api/todo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await load();
    },
    [load],
  );

  const current = items[cursor];

  /* --- klawiatura: cała obsługa bez myszy --- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA";

      // Enter w pustym polu wraca do listy, a poza polem wskakuje w dodawanie.
      if (e.code === "KeyN" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
      if (typing) return;

      if (e.code === "KeyJ" || e.code === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, items.length - 1));
      } else if (e.code === "KeyK" || e.code === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (!current) {
        return;
      } else if (e.code === "Space") {
        e.preventDefault();
        act({ action: "timer", id: current.id });
      } else if (e.code === "KeyD" || e.code === "Delete") {
        e.preventDefault();
        if (confirm(`Usunąć „${current.title}"?`))
          act({ action: "delete", id: current.id });
      } else if (e.code === "KeyP") {
        e.preventDefault();
        act({
          action: "update",
          id: current.id,
          patch: { priority: ((current.priority + 1) % 3) as 0 | 1 | 2 },
        });
      } else if (e.code === "Enter" && onUseAsPrompt) {
        e.preventDefault();
        if (sessionId) act({ action: "link", id: current.id, sessionId });
        onUseAsPrompt(
          current.title + (current.notes ? `\n\n${current.notes}` : ""),
        );
      } else {
        // Cyfry 1-7 przestawiają status zgodnie z kolejnością przepływu.
        const digit = /^Digit([1-7])$/.exec(e.code);
        if (digit) {
          e.preventDefault();
          act({
            action: "update",
            id: current.id,
            patch: { status: STATUSES[Number(digit[1]) - 1].id },
          });
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items.length, current, act, onUseAsPrompt, sessionId]);

  useEffect(() => {
    setCursor(0);
  }, [group, tagFilter, q]);

  // Zaznaczenie ma zostać w polu widzenia przy przewijaniu klawiaturą.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const running = useMemo(() => items.find((t) => t.startedAt), [items]);

  return (
    <div className="space-y-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = parseInput(draft);
          if (!parsed.title) return;
          act({ action: "create", title: parsed.title, patch: parsed });
          setDraft("");
        }}
      >
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.currentTarget.blur();
              setDraft("");
            }
          }}
          placeholder="Nowe zadanie…  #tag  @komu  !pilne  za 3d  co 7d  ~30m"
          className="w-full rounded-lg px-2.5 py-1.5 text-xs outline-none"
          style={{
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
          }}
        />
      </form>

      <div className="flex flex-wrap items-center gap-1">
        <button
          onClick={() => setPlanOnly((v) => !v)}
          className="rounded-lg px-2 py-0.5 text-[10px]"
          style={{
            background: planOnly ? "var(--accent)" : "var(--panel-2)",
            color: planOnly ? "#fff" : "var(--text)",
          }}
          title="Trzy rzeczy na dziś zamiast całej listy"
        >
          plan dnia
        </button>
        <button
          onClick={async () => {
            const res = await fetch("/api/todo?view=attention");
            if (!res.ok) return;
            const d = (await res.json()) as Record<string, Task[]>;
            const lines = [
              `po terminie: ${d.overdue.length}`,
              `zlecone bez ruchu: ${d.staleAssigned.length}`,
              `stoi w trakcie: ${d.stalled.length}`,
              `starsze niż rok: ${d.ancient.length}`,
            ];
            alert(`Do przeglądu:\n\n${lines.join("\n")}`);
          }}
          className="rounded-lg px-2 py-0.5 text-[10px]"
          style={{ background: "var(--panel-2)", color: "var(--warn)" }}
          title="Co wymaga uwagi"
        >
          przegląd
        </button>
        {GROUPS.map((g) => (
          <button
            key={g.id}
            onClick={() => setGroup(g.id)}
            className="rounded-lg px-2 py-0.5 text-[10px]"
            style={{
              background: group === g.id ? "var(--accent)" : "var(--panel-2)",
              color: group === g.id ? "#fff" : "var(--text)",
            }}
          >
            {g.label}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Szukaj…"
          className="ml-auto w-28 rounded-lg px-2 py-0.5 text-[10px] outline-none"
          style={{
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
          }}
        />
      </div>

      {tags.length ? (
        <div className="flex flex-wrap gap-1">
          {tagFilter ? (
            <button
              onClick={() => setTagFilter(undefined)}
              className="rounded px-1.5 py-0.5 text-[10px]"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              #{tagFilter} ✕
            </button>
          ) : (
            tags.slice(0, 8).map((t) => (
              <button
                key={t.tag}
                onClick={() => setTagFilter(t.tag)}
                className="rounded px-1.5 py-0.5 text-[10px] muted"
                style={{ background: "var(--panel-2)" }}
              >
                #{t.tag} <span className="opacity-60">{t.count}</span>
              </button>
            ))
          )}
        </div>
      ) : null}

      {running ? (
        <div
          className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs"
          style={{
            background: "var(--accent-soft)",
            border: "1px solid var(--accent)",
          }}
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: "var(--accent)" }}
          />
          <span className="min-w-0 flex-1 truncate">{running.title}</span>
          <span className="muted">
            {duration(
              running.timeSpentMs + (Date.now() - (running.startedAt ?? 0)),
            )}
          </span>
          <button
            onClick={() => act({ action: "timer", id: running.id })}
            className="underline"
          >
            stop
          </button>
        </div>
      ) : null}

      <div
        ref={listRef}
        className="max-h-[42vh] space-y-1 overflow-y-auto pr-1"
      >
        {items.map((t, i) => {
          const due = dueInfo(t.due);
          const status = STATUSES.find((s) => s.id === t.status)!;
          const selected = i === cursor;
          return (
            <div
              key={t.id}
              data-index={i}
              onMouseEnter={() => setCursor(i)}
              className="rounded-lg px-2.5 py-1.5"
              style={{
                background: selected ? "var(--accent-soft)" : "var(--panel-2)",
                borderLeft: `2px solid ${
                  t.priority === 2
                    ? "var(--err)"
                    : t.priority === 1
                      ? "var(--warn)"
                      : status.color
                }`,
                outline: selected ? "1px solid var(--accent)" : undefined,
              }}
            >
              <div className="flex items-start gap-2">
                <select
                  value={t.status}
                  onChange={(e) =>
                    act({
                      action: "update",
                      id: t.id,
                      patch: { status: e.target.value },
                    })
                  }
                  className="shrink-0 rounded px-1 py-0.5 text-[9px] outline-none"
                  style={{
                    background: "var(--bg)",
                    color: status.color,
                    border: "none",
                  }}
                  title="Status (1-7)"
                >
                  {STATUSES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>

                <div className="min-w-0 flex-1">
                  <div
                    className="text-xs"
                    style={{ opacity: t.status === "zrobione" ? 0.5 : 1 }}
                  >
                    {t.title}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 text-[10px] muted">
                    {t.tags.map((tag) => (
                      <button
                        key={tag}
                        onClick={() => setTagFilter(tag)}
                        style={{ color: "var(--accent)" }}
                      >
                        #{tag}
                      </button>
                    ))}
                    {t.assignedTo ? <span>@{t.assignedTo}</span> : null}
                    {due ? (
                      <span
                        style={{
                          color: due.overdue ? "var(--err)" : undefined,
                        }}
                      >
                        {due.text}
                      </span>
                    ) : null}
                    {t.timeSpentMs ? (
                      <span>{duration(t.timeSpentMs)}</span>
                    ) : null}
                    {t.sessionIds.length ? (
                      <span>{t.sessionIds.length} sesji</span>
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {onUseAsPrompt ? (
                    <button
                      onClick={() => {
                        if (sessionId)
                          act({ action: "link", id: t.id, sessionId });
                        onUseAsPrompt(
                          t.title + (t.notes ? `\n\n${t.notes}` : ""),
                        );
                      }}
                      className="text-[10px] underline muted"
                      title="Wyślij do sesji (Enter)"
                    >
                      do sesji
                    </button>
                  ) : null}
                  <button
                    onClick={() => act({ action: "timer", id: t.id })}
                    className="text-[10px] underline muted"
                    title="Zegar (spacja)"
                  >
                    {t.startedAt ? "stop" : "start"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        {items.length === 0 ? (
          <p className="py-6 text-center text-xs muted">Nic tu nie ma.</p>
        ) : null}
      </div>

      <div className="text-[10px] muted">
        N nowe · J/K wybór · 1-7 status · spacja zegar · P priorytet · Enter do
        sesji · D usuń
      </div>
    </div>
  );
}
