"use client";

import { useEffect, useState } from "react";

type Pulse = {
  failed: { name: string; active: string; sub: string }[];
  running: number;
  dirtyRepos: {
    name: string;
    path: string;
    branch?: string;
    dirtyFiles: number;
    lastCommit?: string;
  }[];
};

/**
 * Puls maszyny: usługi, które padły, i repozytoria z niedokończoną robotą.
 * O jednym i drugim człowiek dowiaduje się zwykle wtedy, gdy jest za późno.
 */
export function PulsePanel({
  onStartSession,
}: {
  onStartSession?: (cwd: string) => void;
}) {
  const [data, setData] = useState<Pulse>();

  useEffect(() => {
    const load = () =>
      fetch("/api/pulse")
        .then((r) => (r.ok ? r.json() : undefined))
        .then((d) => d && setData(d as Pulse))
        .catch(() => undefined);
    load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, []);

  if (!data)
    return <p className="py-8 text-center text-sm muted">Sprawdzam…</p>;

  return (
    <div className="space-y-3">
      <section>
        <h3 className="mb-1 text-[10px] font-semibold muted">
          USŁUGI · {data.running} działa
          {data.failed.length ? `, ${data.failed.length} padło` : ""}
        </h3>
        {data.failed.length ? (
          data.failed.map((u) => (
            <div
              key={u.name}
              className="rounded px-2 py-1 text-[11px] mono"
              style={{ background: "var(--panel-2)", color: "var(--err)" }}
            >
              {u.name}
            </div>
          ))
        ) : (
          <p className="px-1 text-[10px] muted">wszystko chodzi</p>
        )}
      </section>

      <section>
        <h3 className="mb-1 text-[10px] font-semibold muted">
          NIEZACOMMITOWANE ZMIANY · {data.dirtyRepos.length} repozytoriów
        </h3>
        <div className="max-h-[40vh] space-y-1 overflow-y-auto pr-1">
          {data.dirtyRepos.map((r) => (
            <div
              key={r.path}
              className="flex items-center gap-2 rounded px-2 py-1.5"
              style={{ background: "var(--panel-2)" }}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-medium">{r.name}</div>
                <div className="truncate text-[10px] muted">
                  {r.branch ?? "bez gałęzi"}
                  {r.lastCommit ? ` · ${r.lastCommit}` : ""}
                </div>
              </div>
              <span
                className="shrink-0 tabular-nums text-[10px]"
                style={{
                  color: r.dirtyFiles > 50 ? "var(--warn)" : "var(--muted)",
                }}
              >
                {r.dirtyFiles} plików
              </span>
              {onStartSession ? (
                <button
                  onClick={() => onStartSession(r.path)}
                  className="shrink-0 text-[10px] underline muted"
                  title="Otwórz terminal w tym repozytorium"
                >
                  otwórz
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
