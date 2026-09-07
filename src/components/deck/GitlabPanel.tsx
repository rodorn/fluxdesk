"use client";

import { useEffect, useState } from "react";

import { fmtRelative } from "@/lib/format";

type Item = {
  id: number;
  title: string;
  url: string;
  project: string;
  updatedAt?: number;
  draft?: boolean;
};

type Data = {
  configured: boolean;
  mine: Item[];
  review: Item[];
  issues: Item[];
};

/**
 * GitLab obok sesji. Chodzi o jedną rzecz: wiedzieć, że coś czeka, bez
 * zaglądania do przeglądarki i bez przełączania kontekstu.
 */
export function GitlabPanel({
  onStartSession,
}: {
  onStartSession?: (text: string) => void;
}) {
  const [data, setData] = useState<Data>();

  useEffect(() => {
    const load = () =>
      fetch("/api/gitlab")
        .then((r) => (r.ok ? r.json() : undefined))
        .then((d) => d && setData(d as Data))
      .catch(() => undefined);
    load();
    const t = setInterval(load, 180_000);
    return () => clearInterval(t);
  }, []);

  if (!data)
    return <p className="py-8 text-center text-sm muted">Wczytywanie…</p>;
  if (!data.configured) {
    return (
      <p className="py-8 text-center text-sm muted">
        Brak tokenu w <span className="mono">~/.config/gitlab-token</span>.
      </p>
    );
  }

  const groups: { label: string; items: Item[]; tone: string }[] = [
    {
      label: "Do przejrzenia przez Ciebie",
      items: data.review,
      tone: "var(--warn)",
    },
    { label: "Twoje merge requesty", items: data.mine, tone: "var(--accent)" },
    {
      label: "Zgłoszenia przypisane",
      items: data.issues,
      tone: "var(--muted)",
    },
  ];

  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <section key={g.label}>
          <h3
            className="mb-1 text-[10px] font-semibold"
            style={{ color: g.tone }}
          >
            {g.label.toUpperCase()} · {g.items.length}
          </h3>
          <div className="space-y-1">
            {g.items.map((m) => (
              <div
                key={`${g.label}-${m.id}`}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
                style={{ background: "var(--panel-2)" }}
              >
                <a
                  href={m.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1"
                  title={m.title}
                >
                  <span className="block truncate text-[11px]">
                    {m.draft ? <span className="muted">szkic · </span> : null}
                    {m.title}
                  </span>
                  <span className="block truncate text-[10px] mono muted">
                    {m.project} · !{m.id}
                    {m.updatedAt ? ` · ${fmtRelative(m.updatedAt)}` : ""}
                  </span>
                </a>
                {onStartSession ? (
                  <button
                    onClick={() =>
                      onStartSession(`Zajmij się ${m.url}\n\n${m.title}`)
                    }
                    className="shrink-0 text-[10px] underline muted"
                    title="Wyślij do aktywnej sesji"
                  >
                    do sesji
                  </button>
                ) : null}
              </div>
            ))}
            {g.items.length === 0 ? (
              <p className="px-1 text-[10px] muted">nic tu nie czeka</p>
            ) : null}
          </div>
        </section>
      ))}
    </div>
  );
}
