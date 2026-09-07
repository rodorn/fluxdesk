"use client";

import { useCallback, useEffect, useState } from "react";

import { Overlay } from "@/components/deck/Overlay";
import { NotifyPanel } from "@/components/deck/NotifyPanel";
import { RulesPanel } from "@/components/deck/RulesPanel";
import { ProfilePanel } from "@/components/deck/ProfilePanel";
import { SecretsPanel } from "@/components/deck/SecretsPanel";
import { Button, ErrorText } from "@/components/ui";
import { fmtRelative } from "@/lib/format";

type MemoryFile = {
  id: string;
  scope: "global" | "memory" | "project";
  name: string;
  path: string;
  size: number;
  modified: number;
  description?: string;
  type?: string;
};

const SCOPE_LABEL: Record<string, string> = {
  global: "globalne",
  project: "projekt",
  memory: "pamięć",
};

/** Przeglądanie i edycja pamięci: CLAUDE.md oraz plików w katalogu memory projektu. */
export function MemoryPanel({
  cwd,
  onClose,
}: {
  cwd?: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"files" | "profile" | "secrets" | "notify" | "rules">("files");
  const [items, setItems] = useState<MemoryFile[]>([]);
  const [openId, setOpenId] = useState<string>();
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    const res = await fetch(`/api/memory?cwd=${encodeURIComponent(cwd ?? "")}`);
    const data = await res.json();
    if (res.ok) setItems(data.items as MemoryFile[]);
    else setError(data.error);
  }, [cwd]);

  useEffect(() => {
    load();
  }, [load]);

  async function open(id: string) {
    setOpenId(id);
    setStatus(undefined);
    const res = await fetch(
      `/api/memory?id=${encodeURIComponent(id)}&cwd=${encodeURIComponent(cwd ?? "")}`,
    );
    const data = await res.json();
    setContent(res.ok ? (data.content as string) : "");
    setDirty(false);
  }

  async function save() {
    if (!openId) return;
    const res = await fetch("/api/memory", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: openId, cwd, content }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
      return;
    }
    setDirty(false);
    setStatus(`Zapisano ${new Date().toLocaleTimeString("pl-PL")}`);
    load();
  }

  async function remove(id: string) {
    if (!confirm(`Usunąć ${id.split(":")[1]}? Tej operacji nie da się cofnąć.`))
      return;
    const res = await fetch(
      `/api/memory?id=${encodeURIComponent(id)}&cwd=${encodeURIComponent(cwd ?? "")}`,
      { method: "DELETE" },
    );
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
      return;
    }
    if (openId === id) {
      setOpenId(undefined);
      setContent("");
    }
    load();
  }

  async function create() {
    const name = prompt("Nazwa pliku (kebab-case, bez .md):")?.trim();
    if (!name) return;
    const id = `memory:${name.replace(/\.md$/, "")}.md`;
    const template = `---\nname: ${name}\ndescription: \nmetadata:\n  type: project\n---\n\n`;
    const res = await fetch("/api/memory", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, cwd, content: template }),
    });
    if (!res.ok) {
      setError((await res.json()).error);
      return;
    }
    await load();
    open(id);
  }

  const tabs: { id: typeof tab; label: string }[] = [
    { id: "files", label: "Pamięć projektu" },
    { id: "profile", label: "O mnie" },
    { id: "secrets", label: "Sejf" },
    { id: "notify", label: "Powiadomienia" },
    { id: "rules", label: "Zgody" },
  ];

  return (
    <Overlay
      title="Wiedza"
      hint={cwd ? cwd : "wybierz sesję, aby zobaczyć pamięć jej projektu"}
      onClose={onClose}
      wide
    >
      <div className="mb-3 flex gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="rounded-lg px-3 py-1.5 text-xs font-medium"
            style={{
              background: tab === t.id ? "var(--accent)" : "var(--panel-2)",
              color: tab === t.id ? "#fff" : "var(--text)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "profile" ? <ProfilePanel /> : null}
      {tab === "secrets" ? <SecretsPanel /> : null}
      {tab === "notify" ? <NotifyPanel /> : null}
      {tab === "rules" ? <RulesPanel /> : null}

      <div
        className="grid gap-3 md:grid-cols-[16rem_1fr]"
        style={{ display: tab === "files" ? undefined : "none" }}
      >
        <div className="max-h-[55vh] space-y-1 overflow-y-auto pr-1">
          <Button onClick={create} className="w-full">
            + nowe wspomnienie
          </Button>
          {items.map((m) => (
            <div key={m.id} className="flex items-center gap-1">
              <button
                onClick={() => open(m.id)}
                className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left"
                style={{
                  background:
                    m.id === openId ? "var(--accent-soft)" : "var(--panel-2)",
                  border: `1px solid ${m.id === openId ? "var(--accent)" : "transparent"}`,
                }}
              >
                <div className="truncate text-[11px] font-medium">{m.name}</div>
                <div className="truncate text-[10px] muted">
                  {SCOPE_LABEL[m.scope]} · {fmtRelative(m.modified)}
                  {Date.now() - m.modified > 180 * 86_400_000 ? (
                    <span style={{ color: "var(--warn)" }}> · do przeglądu</span>
                  ) : null}
                </div>
                {m.description ? (
                  <div className="truncate text-[10px] muted">
                    {m.description}
                  </div>
                ) : null}
              </button>
              {m.scope === "memory" && m.type !== "index" ? (
                <button
                  onClick={() => remove(m.id)}
                  className="shrink-0 px-1 text-[11px]"
                  style={{ color: "var(--err)" }}
                  title="Usuń"
                >
                  ✕
                </button>
              ) : null}
            </div>
          ))}
        </div>

        <div className="flex min-h-0 flex-col gap-2">
          {openId ? (
            <>
              <textarea
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  setDirty(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    save();
                  }
                }}
                spellCheck={false}
                className="h-[50vh] w-full resize-none rounded-lg p-3 text-xs mono outline-none"
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                }}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] muted">
                  {status ?? (dirty ? "niezapisane zmiany" : "")}
                </span>
                <Button variant="primary" onClick={save} disabled={!dirty}>
                  Zapisz (Ctrl+S)
                </Button>
              </div>
            </>
          ) : (
            <p className="py-16 text-center text-sm muted">
              Wybierz plik z listy.
            </p>
          )}
          <ErrorText>{error}</ErrorText>
        </div>
      </div>
    </Overlay>
  );
}
