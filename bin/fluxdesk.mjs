#!/usr/bin/env node
/**
 * Klient terminalowy Fluxdesk. Rozmawia z tym samym serwerem co panel, więc
 * lista sesji, zadania i terminale są wspólne. Sens jest prosty: gdy siedzisz
 * już w terminalu, nie musisz sięgać po przeglądarkę, żeby wejść w sesję.
 *
 *   fluxdesk            lista sesji i wybór strzałkami
 *   fluxdesk ls         sama lista
 *   fluxdesk attach 3   wejście do sesji o tym numerze
 *   fluxdesk new [kat]  nowy terminal w katalogu (domyślnie bieżący)
 *   fluxdesk todo       otwarte zadania
 */

import net from "node:net";
import path from "node:path";
import process from "node:process";

const BASE = process.env.FLUXDESK_URL || "http://localhost:4317";
const TOKEN = process.env.CSM_ACCESS_TOKEN;

const c = {
  dim: (s) => `[2m${s}[0m`,
  bold: (s) => `[1m${s}[0m`,
  accent: (s) => `[38;5;105m${s}[0m`,
  ok: (s) => `[32m${s}[0m`,
  warn: (s) => `[33m${s}[0m`,
  err: (s) => `[31m${s}[0m`,
};

async function api(pathname, options = {}) {
  const res = await fetch(BASE + pathname, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(TOKEN ? { "x-csm-token": TOKEN } : {}),
      ...(options.headers ?? {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

function short(p, keep = 2) {
  if (!p) return "";
  const parts = p.split("/").filter(Boolean);
  return parts.length <= keep ? p : "…/" + parts.slice(-keep).join("/");
}

function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

/** Sesje panelu i terminale w jednej, wspólnie numerowanej liście. */
async function collect() {
  const [live, term] = await Promise.all([api("/api/live"), api("/api/term")]);
  return [
    ...live.items.map((s) => ({
      id: s.id,
      kind: "sdk",
      title: s.title,
      cwd: s.cwd,
      status: s.status,
      pending: s.pending.length,
      at: s.lastEventAt,
    })),
    ...term.items.map((t) => ({
      id: t.id,
      kind: "term",
      title: t.title,
      cwd: t.cwd,
      status: t.alive ? "running" : "stopped",
      pending: 0,
      at: t.lastOutputAt,
    })),
  ].sort((a, b) => b.at - a.at);
}

function render(items) {
  if (!items.length) {
    console.log(c.dim("Brak sesji. `fluxdesk new` zaczyna nową."));
    return;
  }
  items.forEach((s, i) => {
    const mark =
      s.pending > 0
        ? c.warn("czeka")
        : s.status === "running"
          ? c.accent("pracuje")
          : s.status === "stopped"
            ? c.dim("koniec")
            : c.ok("gotowa");
    const kind = s.kind === "term" ? c.dim("tty") : "   ";
    console.log(
      `${c.bold(String(i + 1).padStart(2))} ${kind} ${s.title.slice(0, 42).padEnd(42)} ` +
        `${mark.padEnd(18)} ${c.dim(short(s.cwd))} ${c.dim(ago(s.at))}`,
    );
  });
}

/**
 * Podłączenie do terminala: surowe wejście leci prosto do gospodarza pty,
 * a jego wyjście na nasz ekran. Ctrl+Q odłącza, nie zabijając sesji.
 */
async function attach(id) {
  const meta = await api(`/api/term`);
  const info = meta.items.find((t) => t.id === id);
  if (!info)
    throw new Error(
      "To nie jest terminal; sesje panelu otwieraj w przeglądarce",
    );

  const socketPath = path.join(
    process.env.HOME,
    ".claude-session-manager",
    "terminals",
    `${id}.sock`,
  );

  const socket = net.connect(socketPath);
  socket.setNoDelay(true);

  process.stdout.write("[2J[H");
  console.log(c.dim(`— ${info.title} — Ctrl+Q odłącza —`));

  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let index;
    while ((index = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.t === "snapshot" || msg.t === "data")
          process.stdout.write(msg.d);
        else if (msg.t === "exit") {
          console.log(c.dim(`\n— sesja zakończona (${msg.code}) —`));
          cleanup(0);
        }
      } catch {
        /* niepełna linia */
      }
    }
  });

  const send = (msg) => socket.write(JSON.stringify(msg) + "\n");

  const resize = () =>
    send({
      t: "resize",
      cols: process.stdout.columns,
      rows: process.stdout.rows,
    });

  const cleanup = (code) => {
    try {
      process.stdin.setRawMode?.(false);
      socket.destroy();
    } catch {
      /* już zamknięte */
    }
    process.exit(code);
  };

  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.on("data", (data) => {
    // Ctrl+Q odłącza klienta, sesja pracuje dalej po stronie gospodarza.
    if (data.length === 1 && data[0] === 0x11) {
      console.log(c.dim("\n— odłączono, sesja działa dalej —"));
      cleanup(0);
      return;
    }
    send({ t: "input", d: data.toString("utf8") });
  });

  process.stdout.on("resize", resize);
  socket.on("connect", resize);
  socket.on("error", (e) => {
    console.error(c.err(`Nie można podłączyć: ${e.message}`));
    cleanup(1);
  });
  process.on("SIGINT", () => send({ t: "input", d: "" }));
}

/** Wybór sesji strzałkami, gdy nie podano numeru. */
async function pick(items) {
  if (!process.stdin.isTTY) {
    render(items);
    return undefined;
  }
  render(items);
  process.stdout.write(c.dim("\nNumer sesji (Enter anuluje): "));

  return new Promise((resolve) => {
    let answer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\n" || ch === "\r") {
          process.stdin.off("data", onData);
          process.stdin.pause();
          const index = Number(answer.trim()) - 1;
          resolve(items[index]);
          return;
        }
        answer += ch;
      }
    };
    process.stdin.on("data", onData);
  });
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  try {
    if (command === "ls" || command === undefined) {
      const items = await collect();
      if (command === "ls") {
        render(items);
        return;
      }
      const chosen = await pick(items);
      if (chosen) {
        if (chosen.kind === "term") await attach(chosen.id);
        else console.log(c.dim(`Sesja panelu: ${BASE}`));
      }
      return;
    }

    if (command === "attach") {
      const items = await collect();
      const chosen = items[Number(rest[0]) - 1];
      if (!chosen) throw new Error("Nie ma sesji o tym numerze");
      await attach(chosen.id);
      return;
    }

    if (command === "new") {
      const cwd = path.resolve(rest[0] ?? process.cwd());
      const info = await api("/api/term", {
        method: "POST",
        body: JSON.stringify({ cwd, permissionMode: "bypassPermissions" }),
      });
      await attach(info.id);
      return;
    }

    if (command === "todo") {
      const { items } = await api("/api/todo");
      for (const t of items.slice(0, 30)) {
        const flag =
          t.priority === 2
            ? c.err("!!")
            : t.priority === 1
              ? c.warn(" !")
              : "  ";
        console.log(
          `${flag} ${t.title.slice(0, 60).padEnd(60)} ${c.dim(t.project ?? "")}`,
        );
      }
      return;
    }

    console.log(
      [
        "fluxdesk            lista sesji i wybór",
        "fluxdesk ls         sama lista",
        "fluxdesk attach N   wejście do sesji",
        "fluxdesk new [kat]  nowy terminal",
        "fluxdesk todo       otwarte zadania",
      ].join("\n"),
    );
  } catch (e) {
    console.error(c.err(e.message));
    console.error(
      c.dim(`Panel pod ${BASE}; sprawdź: systemctl --user status fluxdesk`),
    );
    process.exit(1);
  }
}

main();
