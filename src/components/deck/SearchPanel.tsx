"use client";

import { useEffect, useRef, useState } from "react";

import { fmtRelative, shortenPath } from "@/lib/format";

type Hit = {
  sessionId: string;
  title?: string;
  cwd?: string;
  at?: number;
  excerpt: string;
  role: "user" | "assistant";
};

/** Podświetlenie trafienia bez wstawiania HTML-a. */
function highlight(text: string, needle: string): React.ReactNode[] {
  const at = text.toLowerCase().indexOf(needle.toLowerCase());
  if (at === -1 || !needle) return [text];
  return [
    text.slice(0, at),
    <mark
      key="m"
      style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
    >
      {text.slice(at, at + needle.length)}
    </mark>,
    text.slice(at + needle.length),
  ];
}

/**
 * Wyszukiwarka po wszystkich rozmowach. Transkrypty to ponad gigabajt zapisu
 * tego, co już ustaliliśmy; bez wyszukiwania ta wiedza jest nie do odzyskania.
 */
export function SearchPanel({
  onOpen,
}: {
  onOpen?: (sessionId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Hit[]>([]);
  const [note, setNote] = useState<string>();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    if (q.trim().length < 3) {
      setItems([]);
      setNote(undefined);
      return;
    }
    let cancelled = false;
    setBusy(true);
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => (r.ok ? r.json() : undefined))
        .then((d) => {
          if (cancelled || !d) return;
          setItems(d.items as Hit[]);
          setNote(d.note as string | undefined);
        })
        .catch(() => undefined)
        .finally(() => !cancelled && setBusy(false));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  return (
    <div className="space-y-3">
      <input
        ref={input}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Szukaj w rozmowach: nazwa, fragment zdania, ścieżka…"
        className="w-full rounded-lg px-3 py-2 text-sm outline-none"
        style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
      />

      <p className="text-[10px] muted">
        {busy
          ? "Szukam…"
          : note
            ? note
            : items.length
              ? `${items.length} trafień, od najnowszych`
              : q.trim().length >= 3
                ? "Brak trafień."
                : "Przeszukiwane są wszystkie transkrypty na tej maszynie."}
      </p>

      <div className="max-h-[55vh] space-y-1.5 overflow-y-auto pr-1">
        {items.map((h, i) => (
          <button
            key={`${h.sessionId}-${i}`}
            onClick={() => onOpen?.(h.sessionId)}
            className="block w-full rounded-lg px-2.5 py-2 text-left"
            style={{ background: "var(--panel-2)" }}
          >
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
                {h.title ?? "(bez nazwy)"}
              </span>
              <span className="shrink-0 text-[10px] muted">
                {h.at ? fmtRelative(h.at) : ""}
              </span>
            </div>
            <div className="mt-0.5 text-[11px]">
              <span className="muted">
                {h.role === "user" ? "Ty: " : "Claude: "}
              </span>
              {highlight(h.excerpt, q.trim())}
            </div>
            <div className="truncate text-[10px] mono muted">
              {shortenPath(h.cwd, 2)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
