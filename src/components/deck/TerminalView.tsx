"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui";
import { shortenPath } from "@/lib/format";
import type { TerminalInfo } from "@/lib/terminals";

/**
 * Prawdziwy `claude` w pty, renderowany w karcie przeglądarki.
 * Daje pełen zestaw komend terminala — łącznie z tymi, których panel nie zna.
 */
export function TerminalView({
  info,
  onClose,
  onError,
}: {
  info: TerminalInfo;
  onClose: () => void;
  onError: (msg: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [insights, setInsights] = useState<string[]>();

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    (async () => {
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-web-links"),
      ]);
      if (disposed || !hostRef.current) return;

      const term = new Terminal({
        fontFamily:
          'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
        fontSize: 13,
        cursorBlink: true,
        scrollback: 10_000,
        allowProposedApi: true,
        theme: {
          background: "#0c0d10",
          foreground: "#e6e6e6",
          cursor: "#e6e6e6",
          selectionBackground: "rgba(255,255,255,0.22)",
        },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      // Panel chodzi w oknie aplikacji, gdzie window.open bywa martwe,
      // więc adres oddajemy systemowi i ląduje w zwykłej przeglądarce.
      term.loadAddon(
        new WebLinksAddon((_event, uri) => {
          fetch("/api/open", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: uri }),
          }).catch(() => window.open(uri, "_blank", "noopener"));
        }),
      );
      term.open(hostRef.current);
      fit.fit();
      setReady(true);

      const post = (body: Record<string, unknown>) =>
        fetch(`/api/term/${info.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }).catch(() => undefined);

      // Naciśnięcia zbieramy w mikro-paczki, żeby nie robić żądania na każdy znak.
      let pending = "";
      let flushTimer: ReturnType<typeof setTimeout> | undefined;
      const flush = () => {
        flushTimer = undefined;
        if (!pending) return;
        const data = pending;
        pending = "";
        post({ action: "input", data });
      };
      const onData = term.onData((data) => {
        pending += data;
        // Pierwszy znak leci od razu, kolejne dołączają do paczki: przy pisaniu
        // liczy się reakcja na pierwsze naciśnięcie, nie liczba żądań.
        if (!flushTimer) {
          flush();
          flushTimer = setTimeout(() => {
            flushTimer = undefined;
            flush();
          }, 8);
        }
      });

      // Wklejanie: tekst leci prosto do pty, a obraz zapisujemy i wysyłamy ścieżkę.
      const onPaste = async (e: ClipboardEvent) => {
        const image = [...(e.clipboardData?.items ?? [])].find((i) =>
          i.type.startsWith('image/')
        )
        if (image) {
          e.preventDefault()
          const file = image.getAsFile()
          if (!file) return
          const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result))
            reader.readAsDataURL(file)
          })
          const res = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataUrl }),
          })
          const data = await res.json()
          if (res.ok) post({ action: 'input', data: `${data.path} ` })
          else onError(data.error ?? 'Nie udało się zapisać obrazu')
          return
        }

        const text = e.clipboardData?.getData('text')
        if (text) {
          e.preventDefault()
          post({ action: 'input', data: text })
        }
      }
      hostRef.current?.addEventListener('paste', onPaste)

      const es = new EventSource(`/api/term/${info.id}/stream`);
      es.addEventListener("snapshot", (e) => {
        const d = JSON.parse((e as MessageEvent).data) as { data: string };
        term.write(d.data);
      });
      es.addEventListener("data", (e) => {
        const d = JSON.parse((e as MessageEvent).data) as { data: string };
        term.write(d.data);
      });
      es.onerror = () =>
        onError("Strumień terminala przerwany — próbuję ponownie");

      const resize = () => {
        try {
          fit.fit();
          post({ action: "resize", cols: term.cols, rows: term.rows });
        } catch {
          /* kontener chwilowo bez wymiarów */
        }
      };
      resize();
      const observer = new ResizeObserver(resize);
      if (hostRef.current) observer.observe(hostRef.current);

      term.focus();

      cleanup = () => {
        hostRef.current?.removeEventListener('paste', onPaste)
        observer.disconnect();
        es.close();
        onData.dispose();
        if (flushTimer) clearTimeout(flushTimer);
        term.dispose();
      };
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [info.id, onError]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="panel flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {info.title}
            <span className="ml-2 text-[10px] muted">terminal</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 text-[11px] muted">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: info.alive ? "var(--ok)" : "var(--muted)" }}
            />
            <span className="mono">{shortenPath(info.cwd, 3)}</span>
            {info.model ? <span>{info.model}</span> : null}
            <span>{info.permissionMode}</span>
            <span className="mono">
              {info.cols}×{info.rows}
            </span>
            {info.alive ? null : <span>zakończony ({info.exitCode})</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            onClick={async () => {
              const res = await fetch(`/api/insights?id=${info.id}`);
              const data = await res.json();
              setInsights(res.ok ? (data.candidates as string[]) : []);
            }}
            title="Wyciągnij ustalenia warte zapamiętania"
          >
            Wnioski
          </Button>
          <Button
            onClick={async () => {
              const res = await fetch(`/api/term/${info.id}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "clone" }),
              });
              if (!res.ok) onError((await res.json()).error ?? "Nie udało się rozwidlić");
            }}
            title="Rozwidl rozmowę do drugiej sesji"
          >
            Rozwidl
          </Button>
          <Button
            onClick={async () => {
              const res = await fetch(`/api/term/${info.id}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "record" }),
              });
              const data = await res.json();
              if (!res.ok) return onError(data.error ?? "Nie udało się zapisać");
              // Zapis idzie przez przeglądarkę, żeby trafił tam, gdzie chcesz.
              const blob = new Blob([data.screen as string], { type: "text/plain" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${info.title.replace(/\W+/g, "-")}.txt`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            title="Zapisz ekran do pliku"
          >
            Zapisz
          </Button>
          <Button
            variant="danger"
            onClick={onClose}
            title="Zamknij terminal (Alt+W)"
          >
            Zamknij
          </Button>
        </div>
      </div>

      {insights ? (
        <div className="panel space-y-1 px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold">Warte zapamiętania</span>
            <button onClick={() => setInsights(undefined)} className="text-[10px] underline muted">
              zamknij
            </button>
          </div>
          {insights.length === 0 ? (
            <p className="text-[11px] muted">Nic się nie rzuca w oczy na tym ekranie.</p>
          ) : (
            insights.map((line, i) => (
              <div key={i} className="flex items-start gap-2 text-[11px]">
                <span className="min-w-0 flex-1">{line}</span>
                <button
                  onClick={() =>
                    fetch('/api/todo', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        action: 'create',
                        title: line.slice(0, 90),
                        patch: { tags: ['z-rozmowy'], notes: line, status: 'to_do' },
                      }),
                    }).then(() => setInsights((prev) => prev?.filter((_, j) => j !== i)))
                  }
                  className="shrink-0 text-[10px] underline muted"
                  title="Zrób z tego zadanie"
                >
                  zadanie
                </button>
              </div>
            ))
          )}
        </div>
      ) : null}

      <div
        className="min-h-0 flex-1 overflow-hidden rounded-lg p-2"
        style={{ background: "#0c0d10", border: "1px solid var(--border)" }}
      >
        <div ref={hostRef} className="h-full w-full" />
        {ready ? null : (
          <p className="p-4 text-xs muted">Uruchamiam terminal…</p>
        )}
      </div>
    </div>
  );
}
