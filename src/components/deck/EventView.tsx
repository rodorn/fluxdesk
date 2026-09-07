"use client";

import { Markdown } from "@/components/deck/Markdown";
import { ToolPreview } from "@/components/deck/ToolPreview";
import { fmtDuration, fmtUsd } from "@/lib/format";
import type { LiveEvent } from "@/lib/types";

const STATUS_LABEL: Record<string, string> = {
  starting: "uruchamianie",
  idle: "gotowa",
  running: "pracuje",
  "awaiting-permission": "czeka na zgodę",
  stopped: "zatrzymana",
  error: "błąd",
};

export function statusColor(status: string) {
  if (status === "running" || status === "starting") return "var(--accent)";
  if (status === "awaiting-permission") return "var(--warn)";
  if (status === "error") return "var(--err)";
  if (status === "idle") return "var(--ok)";
  return "var(--muted)";
}

export function StatusDot({
  status,
  label = true,
}: {
  status: string;
  label?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px]">
      <span
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{
          background: statusColor(status),
          animation:
            status === "running"
              ? "pulse 1.4s ease-in-out infinite"
              : undefined,
        }}
      />
      {label ? (STATUS_LABEL[status] ?? status) : null}
    </span>
  );
}

/** Krótkie streszczenie wejścia narzędzia — pierwsze sensowne pole. */
export function toolSummary(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const o = input as Record<string, unknown>;
  const first =
    o.file_path ?? o.path ?? o.command ?? o.pattern ?? o.url ?? o.prompt;
  if (typeof first === "string")
    return first.length > 90 ? first.slice(0, 90) + "…" : first;
  return "";
}

export function EventView({ event }: { event: LiveEvent }) {
  const d = event.data as Record<string, unknown>;
  const time = new Date(event.at).toLocaleTimeString("pl-PL");

  const shell = (children: React.ReactNode, style?: React.CSSProperties) => (
    <div
      className="rounded-lg px-3 py-2"
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        ...style,
      }}
    >
      {children}
    </div>
  );

  switch (event.kind) {
    case "init":
      return shell(
        <div className="text-[11px] muted">
          <span className="mono">sesja {String(d.sessionId).slice(0, 8)}…</span>{" "}
          · {String(d.model ?? "")} ·{" "}
          {Array.isArray(d.tools) ? d.tools.length : 0} narzędzi
        </div>,
      );

    case "user-text":
      return shell(
        <>
          <div
            className="mb-1 text-[11px] font-semibold"
            style={{ color: "var(--accent)" }}
          >
            Ty · {time}
          </div>
          <div className="text-sm whitespace-pre-wrap wrap-anywhere">
            {String(d.text)}
          </div>
        </>,
        { background: "var(--accent-soft)" },
      );

    case "assistant-text":
      return shell(
        <>
          <div className="mb-1 text-[11px] muted">Claude · {time}</div>
          <Markdown source={String(d.text)} />
        </>,
      );

    case "assistant-thinking":
      return shell(
        <details>
          <summary className="cursor-pointer text-[11px] muted">
            rozumowanie
          </summary>
          <div className="mt-1 text-xs whitespace-pre-wrap muted wrap-anywhere">
            {String(d.text)}
          </div>
        </details>,
      );

    case "tool-use":
      return shell(
        <details>
          <summary className="flex cursor-pointer items-center gap-2 text-xs">
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
              style={{
                background: "var(--accent-soft)",
                color: "var(--accent)",
              }}
            >
              {String(d.name)}
            </span>
            <span className="truncate mono muted">{toolSummary(d.input)}</span>
          </summary>
          <div className="mt-1">
            <ToolPreview
              toolName={String(d.name)}
              input={(d.input ?? {}) as Record<string, unknown>}
            />
          </div>
        </details>,
      );

    case "tool-result":
      return shell(
        <details>
          <summary className="cursor-pointer text-[11px] muted">
            {d.isError ? "błąd narzędzia" : "wynik narzędzia"}
          </summary>
          <pre
            className="mt-1 max-h-64 overflow-auto rounded p-2 text-[11px] mono"
            style={{ background: "var(--bg)" }}
          >
            {String(d.content ?? "")}
          </pre>
        </details>,
        d.isError ? { borderColor: "var(--err)" } : undefined,
      );

    case "result":
      return shell(
        <div className="text-[11px] muted">
          Tura zakończona · {fmtDuration(Number(d.durationMs))} ·{" "}
          {String(d.numTurns ?? "")} kroków ·{" "}
          {fmtUsd(Number(d.totalCostUsd) || 0)}
        </div>,
      );

    case "permission-resolved":
      return shell(
        <div className="text-[11px] muted">
          {d.decision === "deny"
            ? "Odrzucono"
            : d.decision === "auto"
              ? "Zezwolono automatycznie"
              : d.decision === "allow-always"
                ? "Zezwolono na stałe"
                : "Zezwolono"}
          : <span className="mono">{String(d.ruleKey || d.toolName)}</span>
        </div>,
      );

    case "todos": {
      const todos = Array.isArray(d.todos)
        ? (d.todos as { content: string; status: string }[])
        : [];
      const done = todos.filter((t) => t.status === "completed").length;
      return shell(
        <div className="text-[11px] muted">
          Lista zadań zaktualizowana · {done}/{todos.length} zrobione
        </div>,
      );
    }

    case "error":
      return shell(
        <div className="text-xs" style={{ color: "var(--err)" }}>
          {String(d.message ?? d.stderr ?? "")}
        </div>,
        { borderColor: "var(--err)" },
      );

    default:
      return null;
  }
}
