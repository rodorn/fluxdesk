"use client";

/**
 * Czytelny podgląd tego, o co prosi narzędzie. Decyzja o zgodzie powinna zapadać
 * na podstawie samej zmiany, a nie surowego JSON-a z polami wejściowymi.
 */

type Input = Record<string, unknown>;

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Zestawienie starej i nowej treści, linia po linii. */
function Diff({ before, after }: { before: string; after: string }) {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");

  // Wspólny początek i koniec pomijamy — liczy się to, co faktycznie się zmienia.
  let head = 0;
  while (
    head < oldLines.length &&
    head < newLines.length &&
    oldLines[head] === newLines[head]
  ) {
    head++;
  }
  let tail = 0;
  while (
    tail < oldLines.length - head &&
    tail < newLines.length - head &&
    oldLines[oldLines.length - 1 - tail] ===
      newLines[newLines.length - 1 - tail]
  ) {
    tail++;
  }

  const removed = oldLines.slice(head, oldLines.length - tail);
  const added = newLines.slice(head, newLines.length - tail);
  const context = head > 0 ? oldLines.slice(Math.max(0, head - 2), head) : [];

  return (
    <div
      className="max-h-64 overflow-auto rounded-lg text-[11px] mono"
      style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
    >
      {context.map((line, i) => (
        <div key={`c${i}`} className="px-2 muted">
          {line || " "}
        </div>
      ))}
      {removed.map((line, i) => (
        <div
          key={`r${i}`}
          className="px-2"
          style={{
            background: "color-mix(in srgb, var(--err) 12%, transparent)",
          }}
        >
          <span style={{ color: "var(--err)" }}>- </span>
          {line || " "}
        </div>
      ))}
      {added.map((line, i) => (
        <div
          key={`a${i}`}
          className="px-2"
          style={{
            background: "color-mix(in srgb, var(--ok) 12%, transparent)",
          }}
        >
          <span style={{ color: "var(--ok)" }}>+ </span>
          {line || " "}
        </div>
      ))}
    </div>
  );
}

function Block({ text, tone }: { text: string; tone?: "command" }) {
  return (
    <pre
      className="max-h-56 overflow-auto rounded-lg p-2 text-[11px] mono"
      style={{
        background: "var(--bg)",
        border: `1px solid ${tone === "command" ? "var(--accent)" : "var(--border)"}`,
      }}
    >
      {text}
    </pre>
  );
}

export function ToolPreview({
  toolName,
  input,
}: {
  toolName: string;
  input: Input;
}) {
  if (toolName === "Bash") {
    const command = str(input.command) ?? "";
    const description = str(input.description);
    return (
      <div className="space-y-1">
        {description ? (
          <div className="text-[11px] muted">{description}</div>
        ) : null}
        <Block text={command} tone="command" />
      </div>
    );
  }

  if (toolName === "Edit" || toolName === "MultiEdit") {
    const path = str(input.file_path);
    const before = str(input.old_string) ?? "";
    const after = str(input.new_string) ?? "";
    return (
      <div className="space-y-1">
        {path ? (
          <div className="truncate text-[11px] mono muted">{path}</div>
        ) : null}
        <Diff before={before} after={after} />
        {input.replace_all ? (
          <div className="text-[10px]" style={{ color: "var(--warn)" }}>
            zamiana wszystkich wystąpień
          </div>
        ) : null}
      </div>
    );
  }

  if (toolName === "Write") {
    const path = str(input.file_path);
    const content = str(input.content) ?? "";
    const lines = content.split("\n").length;
    return (
      <div className="space-y-1">
        {path ? (
          <div className="truncate text-[11px] mono muted">{path}</div>
        ) : null}
        <div className="text-[10px] muted">
          {lines} linii, {content.length} znaków
        </div>
        <Block
          text={
            content.length > 4000 ? content.slice(0, 4000) + "\n…" : content
          }
        />
      </div>
    );
  }

  const summary =
    str(input.file_path) ??
    str(input.path) ??
    str(input.pattern) ??
    str(input.url);
  if (summary) {
    return <div className="truncate text-[11px] mono">{summary}</div>;
  }

  return <Block text={JSON.stringify(input, null, 2)} />;
}
