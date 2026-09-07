import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

/**
 * Przeglądarka w tle: Chrome na wirtualnym ekranie Xvfb, sterowany przez CDP.
 * Sesje mogą się do niej podpiąć bez zabierania ekranu i bez mieszania w oknach,
 * które akurat masz otwarte.
 */
const DISPLAY = process.env.CSM_BROWSER_DISPLAY || ":99";
const CDP_PORT = Number(process.env.CSM_BROWSER_CDP_PORT || 9222);
const SCREEN = process.env.CSM_BROWSER_SCREEN || "1600x1200x24";

export type BrowserStatus = {
  running: boolean;
  cdpPort: number;
  display: string;
  /** Wersja przeglądarki zgłoszona przez CDP. */
  browser?: string;
  webSocketDebuggerUrl?: string;
  tabs?: { title: string; url: string }[];
  error?: string;
};

const profileDir = () => path.join(os.homedir(), ".config", "chrome-cdp");

async function cdp<T>(pathname: string): Promise<T | undefined> {
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}${pathname}`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return undefined;
    return (await res.json()) as T;
  } catch {
    return undefined;
  }
}

export async function browserStatus(): Promise<BrowserStatus> {
  const version = await cdp<{
    Browser?: string;
    webSocketDebuggerUrl?: string;
  }>("/json/version");
  if (!version) return { running: false, cdpPort: CDP_PORT, display: DISPLAY };

  const list =
    await cdp<{ type: string; title: string; url: string }[]>("/json/list");
  return {
    running: true,
    cdpPort: CDP_PORT,
    display: DISPLAY,
    browser: version.Browser,
    webSocketDebuggerUrl: version.webSocketDebuggerUrl,
    tabs: (list ?? [])
      .filter((t) => t.type === "page")
      .map((t) => ({ title: t.title, url: t.url })),
  };
}

/** Odpala Xvfb i Chrome, jeśli jeszcze nie chodzą. Procesy zostają po zamknięciu panelu. */
export async function startBrowser(): Promise<BrowserStatus> {
  const current = await browserStatus();
  if (current.running) return current;

  spawn("Xvfb", [DISPLAY, "-screen", "0", SCREEN], {
    detached: true,
    stdio: "ignore",
  }).unref();

  // Chrome bywa gotowy dopiero po chwili — Xvfb musi wystawić ekran.
  await new Promise((r) => setTimeout(r, 700));

  const env = { ...process.env, DISPLAY };
  delete (env as Record<string, string | undefined>).WAYLAND_DISPLAY;

  spawn(
    "google-chrome-stable",
    [
      "--ozone-platform=x11",
      `--remote-debugging-port=${CDP_PORT}`,
      "--remote-allow-origins=*",
      `--user-data-dir=${profileDir()}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=Translate",
      "about:blank",
    ],
    { detached: true, stdio: "ignore", env },
  ).unref();

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const status = await browserStatus();
    if (status.running) return status;
  }
  return {
    running: false,
    cdpPort: CDP_PORT,
    display: DISPLAY,
    error: "Chrome nie zgłosił się na CDP",
  };
}
