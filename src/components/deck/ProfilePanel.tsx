"use client";

import { useCallback, useEffect, useState } from "react";

import { Button, ErrorText } from "@/components/ui";

type Section = { key: string; value: unknown; shared: boolean };

/**
 * Pamięć o użytkowniku: sekcje z ~/.claude/knowledge/about_me.json.
 * Przełącznik „widoczne dla agentów" decyduje, co ląduje w globalnym CLAUDE.md,
 * więc dane finansowe mogą zostać w panelu, a reszta trafia do każdej sesji.
 */
export function ProfilePanel() {
  const [sections, setSections] = useState<Section[]>([]);
  const [openKey, setOpenKey] = useState<string>();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();

  const load = useCallback(async () => {
    const res = await fetch("/api/profile");
    const data = await res.json();
    if (res.ok) setSections(data.sections as Section[]);
    else setError(data.error);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function open(section: Section) {
    setOpenKey(section.key);
    setDraft(JSON.stringify(section.value, null, 2));
    setStatus(undefined);
  }

  async function save() {
    if (!openKey) return;
    let value: unknown;
    try {
      value = JSON.parse(draft);
    } catch {
      setError("To nie jest poprawny JSON — popraw i spróbuj ponownie");
      return;
    }
    setError(undefined);
    const res = await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: openKey, value }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
      return;
    }
    setSections(data.sections as Section[]);
    setStatus("Zapisano i przekazano agentom");
  }

  async function toggleShared(section: Section) {
    const res = await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: section.key, shared: !section.shared }),
    });
    const data = await res.json();
    if (res.ok) setSections(data.sections as Section[]);
    else setError(data.error);
  }

  async function addSection() {
    const key = prompt('Nazwa nowej sekcji (np. "narzędzia"):')?.trim();
    if (!key) return;
    const res = await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value: {} }),
    });
    const data = await res.json();
    if (res.ok) {
      setSections(data.sections as Section[]);
      open({ key, value: {}, shared: true });
    } else setError(data.error);
  }

  const sharedCount = sections.filter((s) => s.shared).length;

  return (
    <div className="grid gap-3 md:grid-cols-[15rem_1fr]">
      <div className="max-h-[55vh] space-y-1 overflow-y-auto pr-1">
        <p className="px-0.5 text-[10px] muted">
          {sharedCount} z {sections.length} sekcji trafia do każdej sesji przez
          globalny CLAUDE.md.
        </p>
        <Button onClick={addSection} className="w-full">
          + nowa sekcja
        </Button>
        {sections.map((s) => (
          <div key={s.key} className="flex items-center gap-1">
            <button
              onClick={() => open(s)}
              className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left"
              style={{
                background:
                  s.key === openKey ? "var(--accent-soft)" : "var(--panel-2)",
                border: `1px solid ${s.key === openKey ? "var(--accent)" : "transparent"}`,
              }}
            >
              <span className="truncate text-[11px] font-medium">{s.key}</span>
            </button>
            <button
              onClick={() => toggleShared(s)}
              className="shrink-0 rounded px-1 text-[10px]"
              style={{
                background: "var(--panel-2)",
                color: s.shared ? "var(--ok)" : "var(--muted)",
              }}
              title={s.shared ? "Widoczne dla agentów" : "Tylko w panelu"}
            >
              {s.shared ? "agenci" : "prywatne"}
            </button>
          </div>
        ))}
      </div>

      <div className="flex min-h-0 flex-col gap-2">
        {openKey ? (
          <>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  save();
                }
              }}
              spellCheck={false}
              className="h-[48vh] w-full resize-none rounded-lg p-3 text-xs mono outline-none"
              style={{
                background: "var(--bg)",
                border: "1px solid var(--border)",
              }}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] muted">{status}</span>
              <Button variant="primary" onClick={save}>
                Zapisz (Ctrl+S)
              </Button>
            </div>
          </>
        ) : (
          <p className="py-16 text-center text-sm muted">
            Wybierz sekcję z listy. Zapis od razu aktualizuje CLAUDE.md, więc
            wie o tym każda kolejna sesja.
          </p>
        )}
        <ErrorText>{error}</ErrorText>
      </div>
    </div>
  );
}
