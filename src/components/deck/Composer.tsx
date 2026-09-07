"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui";

/**
 * Pole promptu z podpowiedziami. Ukośnik pokazuje komendy zgłoszone przez CLI,
 * małpa szuka plików w katalogu sesji, a strzałki przewijają własną historię.
 */
export function Composer({
  cwd,
  slashCommands,
  placeholder,
  accent,
  inputRef,
  onSend,
}: {
  cwd: string;
  slashCommands: string[];
  placeholder: string;
  accent?: string;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onSend: (text: string, images: string[]) => void;
}) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const history = useRef<string[]>([]);
  const historyPos = useRef(-1);

  /** Token, na którym stoi kursor, o ile zaczyna go ukośnik albo małpa. */
  const token = useMemo(() => {
    const match = /(^\/[\w:-]*)$|(@[^\s]*)$/.exec(text);
    if (!match) return undefined;
    const value = match[1] ?? match[2];
    return {
      value,
      kind: value.startsWith("/") ? ("slash" as const) : ("file" as const),
    };
  }, [text]);

  useEffect(() => {
    if (token?.kind !== "file") {
      setFiles([]);
      return;
    }
    const query = token.value.slice(1);
    let cancelled = false;
    const timer = setTimeout(() => {
      fetch(
        `/api/files?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(query)}`,
      )
        .then((r) => (r.ok ? r.json() : undefined))
        .then((d) => {
          if (!cancelled && d) setFiles(d.items as string[]);
        })
        .catch(() => undefined);
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token, cwd]);

  const suggestions = useMemo(() => {
    if (!token) return [];
    if (token.kind === "slash") {
      const q = token.value.slice(1).toLowerCase();
      return slashCommands
        .filter((c) => c.toLowerCase().includes(q))
        .slice(0, 12);
    }
    return files.slice(0, 12);
  }, [token, slashCommands, files]);

  useEffect(() => {
    setCursor(0);
  }, [suggestions.length]);

  const apply = useCallback(
    (choice: string) => {
      if (!token) return;
      const prefix = text.slice(0, text.length - token.value.length);
      const inserted = token.kind === "slash" ? `/${choice} ` : `@${choice} `;
      setText(prefix + inserted);
      inputRef.current?.focus();
    },
    [token, text, inputRef],
  );

  function submit() {
    const value = text.trim();
    if (!value && !images.length) return;
    history.current = [
      value,
      ...history.current.filter((h) => h !== value),
    ].slice(0, 50);
    historyPos.current = -1;
    setText("");
    setImages([]);
    onSend(value, images);
  }

  /** Zrzut ekranu ze schowka trafia do promptu jako obraz. */
  function onPaste(e: React.ClipboardEvent) {
    const files = [...e.clipboardData.items]
      .filter((i) => i.type.startsWith("image/"))
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f);
    if (!files.length) return;
    e.preventDefault();
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          setImages((prev) => [...prev, reader.result as string]);
        }
      };
      reader.readAsDataURL(file);
    }
  }

  return (
    <div className="relative">
      {suggestions.length ? (
        <div
          className="absolute bottom-full left-0 mb-1 max-h-56 w-full overflow-y-auto rounded-lg"
          style={{
            background: "var(--panel)",
            border: "1px solid var(--border)",
          }}
        >
          {suggestions.map((s, i) => (
            <button
              key={s}
              onMouseEnter={() => setCursor(i)}
              onClick={() => apply(s)}
              className="block w-full truncate px-2.5 py-1 text-left text-[11px] mono"
              style={{
                background: i === cursor ? "var(--accent-soft)" : "transparent",
                color: i === cursor ? "var(--accent)" : "var(--text)",
              }}
            >
              {token?.kind === "slash" ? `/${s}` : s}
            </button>
          ))}
        </div>
      ) : null}

      {images.length ? (
        <div className="mb-1 flex flex-wrap gap-1.5">
          {images.map((src, i) => (
            <div key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={`załącznik ${i + 1}`}
                className="h-14 w-14 rounded object-cover"
                style={{ border: "1px solid var(--border)" }}
              />
              <button
                onClick={() =>
                  setImages((prev) => prev.filter((_, j) => j !== i))
                }
                className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full text-[9px]"
                style={{ background: "var(--err)", color: "#fff" }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex gap-2">
        <textarea
          ref={inputRef}
          value={text}
          onPaste={onPaste}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (suggestions.length) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, suggestions.length - 1));
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
                return;
              }
              if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                e.preventDefault();
                apply(suggestions[cursor]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setFiles([]);
                return;
              }
            }

            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
              return;
            }
            // Historia własnych promptów, jak w powłoce.
            if (e.key === "ArrowUp" && !text.trim() && history.current.length) {
              e.preventDefault();
              historyPos.current = Math.min(
                historyPos.current + 1,
                history.current.length - 1,
              );
              setText(history.current[historyPos.current]);
            } else if (e.key === "ArrowDown" && historyPos.current >= 0) {
              e.preventDefault();
              historyPos.current -= 1;
              setText(
                historyPos.current >= 0
                  ? history.current[historyPos.current]
                  : "",
              );
            }
          }}
          rows={2}
          placeholder={placeholder}
          className="min-w-0 flex-1 resize-y rounded-lg px-3 py-2 text-sm outline-none"
          style={{
            background: "var(--panel)",
            border: `1px solid ${accent ?? "var(--border)"}`,
          }}
        />
        <Button
          variant="primary"
          onClick={submit}
          disabled={!text.trim() && !images.length}
          className="px-4"
        >
          Wyślij
        </Button>
      </div>

      <div className="mt-1 text-[10px] muted">
        / komendy · @ pliki · ↑ historia · Ctrl+V wkleja zrzut · Enter wysyła
      </div>
    </div>
  );
}
