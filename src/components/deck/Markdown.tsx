"use client";

import { useState } from "react";

/**
 * Lekki renderer Markdown na potrzeby odpowiedzi Claude. Świadomie nie ma tu
 * biblioteki: obsługujemy tylko to, co faktycznie pojawia się w rozmowie,
 * a tekst nigdy nie trafia do DOM jako HTML, więc nie ma czego odkażać.
 */

type Block =
  | { kind: "code"; lang?: string; text: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "para"; text: string };

function parse(source: string): Block[] {
  const lines = source.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const fence = /^```(\w+)?\s*$/.exec(line.trim());
    if (fence) {
      const lang = fence[1];
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        body.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ kind: "code", lang, text: body.join("\n") });
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        text: heading[2],
      });
      i++;
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (
        i < lines.length &&
        (ordered
          ? /^\s*\d+[.)]\s+/.test(lines[i])
          : /^\s*[-*+]\s+/.test(lines[i]))
      ) {
        items.push(lines[i].replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ""));
        i++;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ kind: "quote", text: body.join("\n") });
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const body: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^```/.test(lines[i].trim()) &&
      !/^#{1,4}\s/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i])
    ) {
      body.push(lines[i]);
      i++;
    }
    blocks.push({ kind: "para", text: body.join("\n") });
  }

  return blocks;
}

/** Pogrubienia, kursywa, kod w linii i odnośniki — jako elementy Reacta, nie HTML. */
function inline(text: string, keyPrefix = ""): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const pattern =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let n = 0;

  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${n++}`;

    if (token.startsWith("`")) {
      out.push(
        <code
          key={key}
          className="mono rounded px-1 py-0.5 text-[0.92em]"
          style={{ background: "var(--panel-2)" }}
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("[")) {
      const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(token)!;
      out.push(
        <a
          key={key}
          href={link[2]}
          target="_blank"
          rel="noreferrer"
          className="underline"
          style={{ color: "var(--accent)" }}
        >
          {link[1]}
        </a>,
      );
    } else {
      out.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

function CodeBlock({ lang, text }: { lang?: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative">
      <button
        onClick={() => {
          navigator.clipboard?.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        }}
        className="absolute right-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] opacity-0 transition-opacity group-hover:opacity-100"
        style={{ background: "var(--panel-2)", color: "var(--muted)" }}
      >
        {copied ? "skopiowano" : "kopiuj"}
      </button>
      {lang ? (
        <div className="px-2 pt-1 text-[9px] mono muted">{lang}</div>
      ) : null}
      <pre
        className="max-h-96 overflow-auto rounded-lg p-2.5 text-[11px] mono"
        style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
      >
        {text}
      </pre>
    </div>
  );
}

export function Markdown({ source }: { source: string }) {
  const blocks = parse(source);

  // Wiersz dłuższy niż ~95 znaków źle się czyta, także na szerokim ekranie.
  return (
    <div className="max-w-[95ch] space-y-2 text-sm leading-relaxed">
      {blocks.map((b, i) => {
        if (b.kind === "code")
          return <CodeBlock key={i} lang={b.lang} text={b.text} />;

        if (b.kind === "heading") {
          const size = b.level <= 2 ? "text-[15px]" : "text-sm";
          return (
            <div key={i} className={`${size} font-semibold`}>
              {inline(b.text, String(i))}
            </div>
          );
        }

        if (b.kind === "list") {
          const Tag = b.ordered ? "ol" : "ul";
          return (
            <Tag
              key={i}
              className={
                b.ordered
                  ? "list-decimal space-y-0.5 pl-5"
                  : "list-disc space-y-0.5 pl-5"
              }
            >
              {b.items.map((item, j) => (
                <li key={j}>{inline(item, `${i}-${j}`)}</li>
              ))}
            </Tag>
          );
        }

        if (b.kind === "quote") {
          return (
            <blockquote
              key={i}
              className="border-l-2 pl-3 text-[13px] muted"
              style={{ borderColor: "var(--border)" }}
            >
              {inline(b.text, String(i))}
            </blockquote>
          );
        }

        return (
          <p key={i} className="whitespace-pre-wrap wrap-anywhere">
            {inline(b.text, String(i))}
          </p>
        );
      })}
    </div>
  );
}
