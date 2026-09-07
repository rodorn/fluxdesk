"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Overlay } from "@/components/deck/Overlay";
import { fmtRelative, shortenPath } from "@/lib/format";
import type { SessionSummary } from "@/lib/types";

/**
 * Wybór zapisanej sesji do wznowienia. Listę pobieramy raz i filtrujemy na
 * miejscu: przy kilkuset sesjach jest to natychmiastowe, a wyszukiwanie nie
 * zależy od tego, czy zapytanie z frazą dojdzie do serwera.
 */
export function ResumePicker({
  onClose,
  onPick,
  onPickWithOptions,
}: {
  onClose: () => void;
  onPick: (session: SessionSummary) => void;
  /** Wybór z ustawieniami: model, tryb uprawnień, własna nazwa. */
  onPickWithOptions?: (session: SessionSummary) => void;
}) {
  const [q, setQ] = useState("");
  const [all, setAll] = useState<SessionSummary[]>([]);
  const [cursor, setCursor] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/sessions?limit=300")
      .then(async (r) => {
        if (!r.ok) throw new Error(`serwer odpowiedział ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (cancelled) return;
        setAll((d.items ?? d.sessions ?? []) as SessionSummary[]);
        setState("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((s) =>
      [s.customTitle, s.summary, s.firstPrompt, s.cwd, s.gitBranch, s.sessionId]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [all, q]);

  useEffect(() => {
    setCursor(0);
  }, [q]);

  // Zaznaczenie ma zostawać w polu widzenia przy chodzeniu strzałkami.
  useEffect(() => {
    listRef.current?.children[cursor]?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  return (
    <Overlay
      title="Wznów zapisaną sesję"
      hint="↑↓ wybór · Enter wznawia od razu · Shift+Enter z ustawieniami · Esc zamyka"
      onClose={onClose}
      wide
    >
      <input
        ref={input}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setCursor((c) => Math.min(c + 1, items.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setCursor((c) => Math.max(c - 1, 0));
          } else if (e.key === "Enter" && items[cursor]) {
            e.preventDefault();
            if (e.shiftKey && onPickWithOptions)
              onPickWithOptions(items[cursor]);
            else onPick(items[cursor]);
          }
        }}
        placeholder="Szukaj po nazwie, ścieżce, gałęzi, treści pierwszego promptu…"
        className="mb-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
        style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
      />

      <div className="mb-2 text-[10px] muted">
        {state === "loading"
          ? "Wczytuję listę sesji…"
          : state === "error"
            ? `Nie udało się wczytać: ${error}`
            : `${items.length} z ${all.length} sesji`}
      </div>

      <ul ref={listRef} className="space-y-1">
        {items.map((s, i) => (
          <li key={s.sessionId}>
            <button
              onMouseEnter={() => setCursor(i)}
              onClick={() => onPick(s)}
              className="w-full rounded-lg px-3 py-2 text-left"
              style={{
                background: i === cursor ? "var(--accent-soft)" : "transparent",
                border: `1px solid ${i === cursor ? "var(--accent)" : "transparent"}`,
              }}
            >
              <div className="truncate text-xs font-medium">
                {s.customTitle || s.summary || s.firstPrompt || s.sessionId}
              </div>
              <div className="flex flex-wrap gap-x-2 text-[10px] muted">
                <span className="mono">{shortenPath(s.cwd, 3)}</span>
                {s.gitBranch ? <span>⎇ {s.gitBranch}</span> : null}
                <span>{fmtRelative(s.lastModified)}</span>
              </div>
            </button>
          </li>
        ))}
        {state === "ready" && items.length === 0 ? (
          <li className="py-6 text-center text-sm muted">
            {all.length
              ? "Nic nie pasuje do tej frazy."
              : "Brak zapisanych sesji."}
          </li>
        ) : null}
      </ul>
    </Overlay>
  );
}
