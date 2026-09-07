"use client";

import { useCallback, useEffect, useState } from "react";

import { Button, ErrorText, Input } from "@/components/ui";

type SecretMeta = {
  name: string;
  description?: string;
  envVar?: string;
  exposed: boolean;
  hint: string;
  updatedAt: number;
};

/**
 * Sejf na tokeny. Wartości nie wracają do przeglądarki, dopóki ich świadomie
 * nie odsłonisz, a do sesji trafiają tylko te oznaczone jako udostępniane.
 */
export function SecretsPanel() {
  const [items, setItems] = useState<SecretMeta[]>([]);
  const [filter, setFilter] = useState("");
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/secrets");
    const data = await res.json();
    if (res.ok) setItems(data.items as SecretMeta[]);
    else setError(data.error);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function reveal(name: string) {
    if (revealed[name]) {
      setRevealed((r) => {
        const next = { ...r };
        delete next[name];
        return next;
      });
      return;
    }
    const res = await fetch(`/api/secrets?reveal=${encodeURIComponent(name)}`);
    const data = await res.json();
    if (res.ok) setRevealed((r) => ({ ...r, [name]: data.value as string }));
    else setError(data.error);
  }

  async function update(name: string, patch: Partial<SecretMeta>) {
    const res = await fetch("/api/secrets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, ...patch }),
    });
    const data = await res.json();
    if (res.ok) setItems(data.items as SecretMeta[]);
    else setError(data.error);
  }

  async function remove(name: string) {
    if (!confirm(`Usunąć sekret ${name}? Tej operacji nie da się cofnąć.`))
      return;
    const res = await fetch(`/api/secrets?name=${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (res.ok) setItems(data.items as SecretMeta[]);
    else setError(data.error);
  }

  async function add() {
    if (!newName.trim() || !newValue.trim()) return;
    const res = await fetch("/api/secrets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), value: newValue.trim() }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
      return;
    }
    setItems(data.items as SecretMeta[]);
    setNewName("");
    setNewValue("");
    setStatus("Dodano");
  }

  async function importEnv() {
    setStatus("Skanuję pliki .env…");
    const res = await fetch("/api/secrets/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
      return;
    }
    setStatus(`Zaimportowano ${data.added} z ${data.sources} plików`);
    load();
  }

  const shown = items.filter((s) =>
    `${s.name} ${s.description ?? ""}`
      .toLowerCase()
      .includes(filter.trim().toLowerCase()),
  );
  const exposed = items.filter((s) => s.exposed).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Szukaj sekretu…"
          className="min-w-0 flex-1 rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
        />
        <Button onClick={importEnv}>Zaimportuj z .env</Button>
      </div>

      <p className="text-[10px] muted">
        {items.length} sekretów, {exposed} podawanych sesjom jako zmienne
        środowiskowe. Plik jest zaszyfrowany kluczem lokalnym — chroni przed
        kopią zapasową i gitem, nie przed kimś, kto ma dostęp do tego konta.
      </p>

      <div className="max-h-[40vh] space-y-1 overflow-y-auto pr-1">
        {shown.map((s) => (
          <div
            key={s.name}
            className="rounded-lg px-2.5 py-2"
            style={{ background: "var(--panel-2)" }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium mono">
                {s.name}
              </span>
              <span className="shrink-0 text-[10px] mono muted">
                {revealed[s.name] ?? s.hint}
              </span>
            </div>
            {s.description ? (
              <div className="truncate text-[10px] muted">{s.description}</div>
            ) : null}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <button
                onClick={() => reveal(s.name)}
                className="text-[10px] underline"
              >
                {revealed[s.name] ? "ukryj" : "pokaż"}
              </button>
              {revealed[s.name] ? (
                <button
                  onClick={() =>
                    navigator.clipboard?.writeText(revealed[s.name])
                  }
                  className="text-[10px] underline"
                >
                  kopiuj
                </button>
              ) : null}
              <label className="flex items-center gap-1 text-[10px]">
                <input
                  type="checkbox"
                  checked={s.exposed}
                  onChange={(e) =>
                    update(s.name, { exposed: e.target.checked })
                  }
                />
                podawaj sesjom
              </label>
              <input
                defaultValue={s.envVar ?? ""}
                onBlur={(e) => {
                  if (e.target.value !== (s.envVar ?? ""))
                    update(s.name, { envVar: e.target.value });
                }}
                placeholder="ZMIENNA_ENV"
                className="w-40 rounded px-1.5 py-0.5 text-[10px] mono outline-none"
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                }}
              />
              <button
                onClick={() => remove(s.name)}
                className="ml-auto text-[10px] underline"
                style={{ color: "var(--err)" }}
              >
                usuń
              </button>
            </div>
          </div>
        ))}
        {shown.length === 0 ? (
          <p className="py-6 text-center text-sm muted">Nic nie pasuje.</p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="nazwa/nowego-sekretu"
          className="max-w-[14rem]"
        />
        <Input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          type="password"
          placeholder="wartość"
          className="max-w-[14rem]"
        />
        <Button
          variant="primary"
          onClick={add}
          disabled={!newName.trim() || !newValue.trim()}
        >
          Dodaj
        </Button>
        <span className="text-[11px] muted">{status}</span>
      </div>

      <ErrorText>{error}</ErrorText>
    </div>
  );
}
