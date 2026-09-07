#!/usr/bin/env node
/**
 * Gospodarz terminala. Trzyma proces `claude` w pty i wystawia go na gnieździe
 * uniksowym, więc przeżywa restart panelu, a nawet jego przebudowę. Panel jest
 * tylko klientem: podłącza się, dostaje dotychczasowy ekran i strumień dalszych
 * zmian, a po rozłączeniu proces pracuje dalej.
 *
 * Uruchomienie: node pty-host.mjs <plik-gniazda> <plik-meta>
 * Metadane (katalog, argumenty, rozmiar okna) czytamy z pliku, żeby nie
 * przepychać ich przez wiersz poleceń.
 */

import fs from "node:fs";
import net from "node:net";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const [socketPath, metaPath] = process.argv.slice(2);
if (!socketPath || !metaPath) {
  console.error("użycie: pty-host.mjs <plik-gniazda> <plik-meta>");
  process.exit(2);
}

const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
const SCROLLBACK = 400_000;

const { spawn } = require("node-pty");

const term = spawn(meta.command ?? "claude", meta.args ?? [], {
  name: "xterm-256color",
  cwd: meta.cwd,
  cols: meta.cols ?? 120,
  rows: meta.rows ?? 32,
  env: {
    ...process.env,
    ...(meta.env ?? {}),
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
  },
});

let buffer = "";
let chunks = 0;
let lastOutputAt = Date.now();
let alive = true;
let exitCode;
const clients = new Set();

/**
 * Ostatnia sensowna linia ekranu, bez kodów sterujących i ramek. Panel pokazuje
 * ją na liście rozmów, żeby było widać, co sesja właśnie robi.
 */
function lastLine() {
  const plain = buffer
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b[()][A-Z0-9]/g, "")
    .replace(/\r/g, "\n");

  const lines = plain
    .split("\n")
    .map((l) => l.replace(/[\u2500-\u257f\u2580-\u259f]/g, "").trim())
    .filter((l) => l.length > 2 && !/^[·•>\s]*$/.test(l));

  return lines.at(-1)?.slice(0, 120);
}

function writeMeta() {
  const state = {
    ...meta,
    hostPid: process.pid,
    ptyPid: term.pid,
    alive,
    exitCode,
    chunks,
    lastOutputAt,
    lastLine: lastLine(),
    cols: meta.cols,
    rows: meta.rows,
  };
  try {
    fs.writeFileSync(metaPath, JSON.stringify(state, null, 2));
  } catch {
    /* katalog mógł zniknąć przy sprzątaniu */
  }
}

function broadcast(payload) {
  const line = JSON.stringify(payload) + "\n";
  for (const socket of clients) {
    try {
      socket.write(line);
    } catch {
      clients.delete(socket);
    }
  }
}

term.onData((data) => {
  buffer += data;
  if (buffer.length > SCROLLBACK) buffer = buffer.slice(-SCROLLBACK);
  chunks++;
  lastOutputAt = Date.now();
  broadcast({ t: "data", d: data });
});

term.onExit(({ exitCode: code }) => {
  alive = false;
  exitCode = code;
  writeMeta();
  broadcast({ t: "exit", code });
  // Zostawiamy chwilę na dostarczenie ostatnich bajtów podłączonym klientom.
  setTimeout(() => process.exit(0), 1500);
});

const server = net.createServer((socket) => {
  clients.add(socket);
  socket.setNoDelay(true);
  socket.write(
    JSON.stringify({ t: "snapshot", d: buffer, alive, exitCode }) + "\n",
  );

  let pending = "";
  socket.on("data", (chunk) => {
    pending += chunk.toString("utf8");
    let index;
    while ((index = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, index);
      pending = pending.slice(index + 1);
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.t === "input" && typeof msg.d === "string") term.write(msg.d);
        else if (msg.t === "resize" && msg.cols && msg.rows) {
          meta.cols = msg.cols;
          meta.rows = msg.rows;
          term.resize(msg.cols, msg.rows);
          writeMeta();
        } else if (msg.t === "kill") {
          term.kill();
        }
      } catch {
        /* niepełna albo uszkodzona linia */
      }
    }
  });

  socket.on("close", () => clients.delete(socket));
  socket.on("error", () => clients.delete(socket));
});

try {
  fs.unlinkSync(socketPath);
} catch {
  /* gniazdo po poprzednim uruchomieniu */
}

server.listen(socketPath, () => {
  fs.chmodSync(socketPath, 0o600);
  writeMeta();
});

// Odświeżamy metadane co jakiś czas, żeby panel po restarcie znał stan bez podłączania.
setInterval(writeMeta, 5000).unref?.();

const shutdown = () => {
  try {
    server.close();
    fs.unlinkSync(socketPath);
  } catch {
    /* już posprzątane */
  }
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
