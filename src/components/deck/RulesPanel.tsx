"use client";

import { useCallback, useEffect, useState } from "react";

import { Button, ErrorText } from "@/components/ui";

type Rules = { allow: string[]; deny: string[] };

/**
 * Reguły zgód wspólne dla wszystkich sesji. Lista zakazana działa niezależnie
 * od trybu uprawnień, więc nawet sesja z pominięciem pytań nie wykona `rm -rf /`.
 */
export function RulesPanel() {
  const [rules, setRules] = useState<Rules>();
  const [draft, setDraft] = useState("");
  const [denyDraft, setDenyDraft] = useState("");
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    const res = await fetch("/api/rules");
    const data = await res.json();
    if (res.ok) setRules(data as Rules);
    else setError(data.error);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function send(body: Record<string, unknown>) {
    const res = await fetch("/api/rules", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
      return;
    }
    if (Array.isArray(data.imported)) {
      setStatus(
        data.imported.length
          ? `Zaimportowano ${data.imported.length} reguł z settings.json`
          : "Nic nowego do zaimportowania",
      );
      load();
      return;
    }
    setRules(data as Rules);
  }

  if (!rules)
    return <p className="py-10 text-center text-sm muted">Wczytywanie…</p>;

  const wideOpen = rules.allow.filter((r) => /^\w+\(\*\)$|^\*$/.test(r));

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="space-y-2">
        <h3 className="text-xs font-semibold">Bez pytania</h3>
        <p className="text-[10px] muted">
          Klucz narzędzia albo wzorzec z gwiazdką, na przykład{" "}
          <span className="mono">Bash(git)</span> czy{" "}
          <span className="mono">Read(*)</span>. Zgoda „zawsze" udzielona w
          sesji dopisuje się tutaj.
        </p>

        {wideOpen.length ? (
          <p className="text-[10px]" style={{ color: "var(--warn)" }}>
            {wideOpen.join(", ")} dopuszcza wszystko dla tych narzędzi. To
            odpowiednik pracy bez pytań.
          </p>
        ) : null}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            send({ action: "add", rule: draft.trim() });
            setDraft("");
          }}
          className="flex gap-1.5"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Bash(git)"
            className="min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-xs mono outline-none"
            style={{
              background: "var(--panel-2)",
              border: "1px solid var(--border)",
            }}
          />
          <Button type="submit" disabled={!draft.trim()}>
            Dodaj
          </Button>
        </form>

        <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
          {rules.allow.map((r) => (
            <div
              key={r}
              className="flex items-center gap-2 rounded px-2 py-1 text-[11px] mono"
              style={{ background: "var(--panel-2)" }}
            >
              <span className="min-w-0 flex-1 truncate">{r}</span>
              <button
                onClick={() => send({ action: "remove", rule: r })}
                style={{ color: "var(--err)" }}
              >
                ✕
              </button>
            </div>
          ))}
          {rules.allow.length === 0 ? (
            <p className="py-4 text-center text-[11px] muted">
              Pusto, każde narzędzie pyta.
            </p>
          ) : null}
        </div>

        <Button onClick={() => send({ action: "import" })}>
          Zaimportuj z settings.json
        </Button>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold">Nigdy</h3>
        <p className="text-[10px] muted">
          Dopasowanie po fragmencie polecenia. Działa zawsze, także w sesjach z
          pominięciem pytań.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!denyDraft.trim()) return;
            send({ deny: [...rules.deny, denyDraft.trim()] });
            setDenyDraft("");
          }}
          className="flex gap-1.5"
        >
          <input
            value={denyDraft}
            onChange={(e) => setDenyDraft(e.target.value)}
            placeholder="shutdown"
            className="min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-xs mono outline-none"
            style={{
              background: "var(--panel-2)",
              border: "1px solid var(--border)",
            }}
          />
          <Button type="submit" disabled={!denyDraft.trim()}>
            Dodaj
          </Button>
        </form>

        <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
          {rules.deny.map((r) => (
            <div
              key={r}
              className="flex items-center gap-2 rounded px-2 py-1 text-[11px] mono"
              style={{ background: "var(--panel-2)", color: "var(--err)" }}
            >
              <span className="min-w-0 flex-1 truncate">{r}</span>
              <button
                onClick={() =>
                  send({ deny: rules.deny.filter((x) => x !== r) })
                }
                className="muted"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </section>

      <div className="md:col-span-2">
        <span className="text-[11px] muted">{status}</span>
        <ErrorText>{error}</ErrorText>
      </div>
    </div>
  );
}
