"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui";
import { useLang } from "@/lib/i18n";

type Event = {
  id: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  source: string;
  color: string;
  location?: string;
  meetingUrl?: string;
  own?: boolean;
  taskId?: string;
};

type Source = {
  id: string;
  name: string;
  url: string;
  color: string;
  enabled: boolean;
  lastSync?: number;
  lastError?: string;
};

type Task = {
  id: string;
  title: string;
  status: string;
  estimateMin?: number;
  project?: string;
};

/** Siatka dnia: od siódmej do dwudziestej drugiej, w krokach po pół godziny. */
const START_HOUR = 7;
const END_HOUR = 22;
const SLOT_MIN = 30;
const SLOT_PX = 22;

function startOfDay(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function hhmm(at: number): string {
  return new Date(at).toLocaleTimeString("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Kalendarz. Wydarzenia z Google i Outlooka wczytujemy z prywatnych adresów ICS,
 * a bloki czasu zakładane tutaj trzymamy u siebie i wystawiamy własnym ICS-em.
 * Zadanie przeciągnięte na siatkę staje się blokiem: planowanie dnia sprowadza
 * się do przesunięcia kilku pozycji z listy na godziny.
 */
type Account = {
  id: string;
  provider: "google" | "microsoft";
  label: string;
  configured: boolean;
  connected: boolean;
};

type Proposal = {
  title: string;
  start: number;
  end: number;
  estimated: boolean;
  reason?: string;
  source: "parser" | "model";
  conflicts: { title: string; start: number; end: number; source: string }[];
};

/**
 * Układ wydarzeń nachodzących na siebie. Zamiast rysować jedno na drugim,
 * dzielimy szerokość na tyle kolumn, ile terminów nakłada się w danej chwili,
 * więc każdy jest widoczny i klikalny.
 */
function withColumns<T extends { start: number; end: number }>(
  events: T[],
): (T & { column: number; columns: number })[] {
  const sorted = [...events].sort(
    (a, b) => a.start - b.start || b.end - a.end,
  );
  const out: (T & { column: number; columns: number })[] = [];

  // Grupa to ciąg wydarzeń stykających się ze sobą; dopiero przerwa ją kończy.
  let group: (T & { column: number; columns: number })[] = [];
  let groupEnd = -Infinity;

  const closeGroup = () => {
    const width = group.reduce((max, e) => Math.max(max, e.column + 1), 1);
    for (const e of group) e.columns = width;
    out.push(...group);
    group = [];
    groupEnd = -Infinity;
  };

  for (const event of sorted) {
    if (event.start >= groupEnd && group.length) closeGroup();

    // Pierwsza kolumna, w której nie ma jeszcze kolizji.
    const taken = new Set(
      group.filter((e) => e.end > event.start).map((e) => e.column),
    );
    let column = 0;
    while (taken.has(column)) column++;

    group.push({ ...event, column, columns: 1 });
    groupEnd = Math.max(groupEnd, event.end);
  }
  if (group.length) closeGroup();

  return out;
}

/** Pole datetime-local chce czasu lokalnego bez strefy. */
function forInput(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CalendarPanel() {
  const { t } = useLang();
  const [day, setDay] = useState(() => startOfDay(Date.now()));
  const [events, setEvents] = useState<Event[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dragging, setDragging] = useState<Task>();
  const [showSources, setShowSources] = useState(false);
  const [form, setForm] = useState({ name: "", url: "" });
  const [connections, setConnections] = useState<
    Record<string, { configured: boolean; connected: boolean }>
  >({});
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [freeSlots, setFreeSlots] = useState<{ start: number; end: number }[]>();
  const [appForm, setAppForm] = useState({
    provider: "google",
    label: "",
    clientId: "",
    clientSecret: "",
    tenant: "",
  });
  const [quick, setQuick] = useState("");
  const [mirror, setMirror] = useState<string>();
  const [selected, setSelected] = useState<Event>();
  const [thinking, setThinking] = useState(false);
  const [proposal, setProposal] = useState<Proposal>();
  const [quickError, setQuickError] = useState<string>();
  const [showHow, setShowHow] = useState(false);
  const [copied, setCopied] = useState(false);
  // Adres powrotny musi zgadzać się z hostem, z którego korzystasz; z telefonu
  // jest inny niż na komputerze, więc bierzemy go z okna, a nie na sztywno.
  const redirect =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/api/calendar/oauth/${appForm.provider}`;
  const gridRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const from = day;
    const to = day + 86_400_000;
    const [cal, todo] = await Promise.all([
      fetch(`/api/calendar?from=${from}&to=${to}`).then((r) =>
        r.ok ? r.json() : undefined,
      ),
      fetch("/api/todo?group=open").then((r) => (r.ok ? r.json() : undefined)),
    ]);
    if (cal) {
      setEvents(cal.events as Event[]);
      setSources(cal.sources as Source[]);
    }
    const conn = await fetch("/api/calendar?view=sources")
      .then((r) => (r.ok ? r.json() : undefined))
      .catch(() => undefined);
    if (conn?.connections) setConnections(conn.connections);
    if (conn?.accounts) setAccounts(conn.accounts as Account[]);
    if (todo) setTasks((todo.items as Task[]).slice(0, 20));
  }, [day]);

  useEffect(() => {
    load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, [load]);

  /**
   * Zgoda otwiera się w zwykłej przeglądarce, nie w oknie panelu: to okno nie
   * ma paska adresu, więc po błędzie dostawcy nie dałoby się z niego wrócić.
   */
  function connectAccount(id: string) {
    const provider = id.split(":")[0];
    const url = `${window.location.origin}/api/calendar/oauth/${provider}?state=${encodeURIComponent(id)}`;
    fetch("/api/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }).catch(() => window.open(url, "_blank", "noopener"));
    // Po powrocie ze zgody stan zmienia się po stronie serwera, więc kilka
    // razy dopytujemy, zamiast kazać odświeżać panel ręcznie.
    let tries = 0;
    const timer = setInterval(() => {
      load();
      if (++tries > 20) clearInterval(timer);
    }, 3000);
  }

  /** Otwiera konsolę dostawcy w zwykłej przeglądarce, poza oknem panelu. */
  function openConsole(provider: string) {
    const url =
      provider === "google"
        ? "https://console.cloud.google.com/apis/credentials"
        : "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade";
    fetch("/api/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }).catch(() => window.open(url, "_blank", "noopener"));
  }

  /** Wysyła zdanie do rozpoznania i pokazuje propozycję do poprawienia. */
  async function askQuick() {
    const text = quick.trim();
    if (!text) return;
    setThinking(true);
    setQuickError(undefined);
    try {
      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "quick", text }),
      });
      const data = await res.json();
      if (!res.ok) setQuickError(data.error ?? "Nie rozumiem terminu");
      else setProposal(data as Proposal);
    } catch {
      setQuickError("Panel nie odpowiedział");
    } finally {
      setThinking(false);
    }
  }

  /** Zapisuje propozycję po ewentualnych poprawkach użytkownika. */
  async function acceptProposal() {
    if (!proposal) return;
    await send({
      action: "block",
      title: proposal.title,
      start: proposal.start,
      end: proposal.end,
    });
    setDay(startOfDay(proposal.start));
    setProposal(undefined);
    setQuick("");
  }

  async function send(body: Record<string, unknown>) {
    await fetch("/api/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    load();
  }

  /** Pozycja kursora na siatce zamieniona na godzinę bloku. */
  function slotAt(clientY: number): number {
    const box = gridRef.current?.getBoundingClientRect();
    if (!box) return day + START_HOUR * 3_600_000;
    const offset = Math.max(0, clientY - box.top);
    const slot = Math.floor(offset / SLOT_PX);
    return day + START_HOUR * 3_600_000 + slot * SLOT_MIN * 60_000;
  }

  const slots = useMemo(() => {
    const out: number[] = [];
    for (let h = START_HOUR; h < END_HOUR; h++) {
      out.push(day + h * 3_600_000, day + h * 3_600_000 + 30 * 60_000);
    }
    return out;
  }, [day]);

  const timed = events.filter((e) => !e.allDay);
  const allDay = events.filter((e) => e.allDay);
  const isToday = startOfDay(Date.now()) === day;

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_16rem]">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setDay((d) => d - 86_400_000)}>‹</Button>
          <span className="text-sm font-medium">
            {new Date(day).toLocaleDateString("pl-PL", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </span>
          <Button onClick={() => setDay((d) => d + 86_400_000)}>›</Button>
          {!isToday ? (
            <Button onClick={() => setDay(startOfDay(Date.now()))}>dziś</Button>
          ) : null}
          <span className="flex-1" />
          <Button
            onClick={async () => {
              const res = await fetch("/api/calendar", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "mirror", days: 14 }),
              }).catch(() => undefined);
              const d = await res?.json().catch(() => undefined);
              setMirror(
                d
                  ? `zasłonięto: ${d.created} nowych, ${d.updated} zmienionych, ${d.removed} usuniętych`
                  : "nie udało się",
              );
              load();
              setTimeout(() => setMirror(undefined), 6000);
            }}
            title="Przenosi godziny z subskrypcji na połączone konta jako „Zajęte”, bez nazw"
          >
            {t("Zasłoń zajętość")}
          </Button>
          <Button onClick={() => setShowSources((v) => !v)}>
            {showSources ? t("Ukryj źródła") : `${t("Źródła")} (${sources.length})`}
          </Button>
        </div>

        {(["google", "microsoft"] as const).some(
          (p) => !connections[p]?.connected,
        ) ? (
          <div
            className="flex flex-wrap items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px]"
            style={{
              background: "var(--panel-2)",
              border: "1px solid var(--border)",
            }}
          >
            <span className="muted">Zapis do kalendarzy:</span>
            {(["google", "microsoft"] as const).map((p) => (
              <span key={p} className="flex items-center gap-1">
                <span
                  style={{
                    color: connections[p]?.connected
                      ? "var(--ok)"
                      : "var(--warn)",
                  }}
                >
                  {p === "google" ? "Google" : "Outlook"}{" "}
                  {connections[p]?.connected ? "połączony" : "niepołączony"}
                </span>
                {!connections[p]?.connected ? (
                  <Button
                    variant="primary"
                    onClick={() => {
                      if (connections[p]?.configured) {
                        window.location.href = `/api/calendar/oauth/${p}`;
                        return;
                      }
                      setShowSources(true);
                      setAppForm((f) => ({ ...f, provider: p }));
                      setShowHow(true);
                      openConsole(p);
                    }}
                  >
                    {connections[p]?.configured
                      ? "Połącz"
                      : `Podłącz ${p === "google" ? "Google" : "Microsoft"}`}
                  </Button>
                ) : null}
              </span>
            ))}
          </div>
        ) : null}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            askQuick();
          }}
          className="flex gap-1.5"
        >
          <input
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            placeholder="dentysta środa 16"
            className="min-w-0 flex-1 rounded px-2 py-1.5 text-xs outline-none"
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
            }}
          />
          <Button variant="primary" type="submit">
            {thinking ? t("Liczę…") : t("Zaplanuj")}
          </Button>
        </form>

        {mirror ? (
          <p className="text-[11px] muted">{mirror}</p>
        ) : null}

        {quickError ? (
          <p className="text-[11px]" style={{ color: "var(--warn)" }}>
            {quickError}
          </p>
        ) : null}

        {proposal ? (
          <div
            className="space-y-2 rounded-lg px-3 py-2"
            style={{
              background: "var(--panel-2)",
              border: "1px solid var(--border)",
            }}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                value={proposal.title}
                onChange={(e) =>
                  setProposal((p) => p && { ...p, title: e.target.value })
                }
                className="min-w-0 flex-1 rounded px-2 py-1 text-xs font-semibold outline-none"
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                }}
              />
              <input
                type="datetime-local"
                value={forInput(proposal.start)}
                onChange={(e) => {
                  const at = new Date(e.target.value).getTime();
                  if (Number.isNaN(at)) return;
                  setProposal(
                    (p) =>
                      p && { ...p, start: at, end: at + (p.end - p.start) },
                  );
                }}
                className="rounded px-2 py-1 text-xs outline-none"
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                }}
              />
              <input
                type="number"
                min={5}
                step={5}
                value={Math.round((proposal.end - proposal.start) / 60_000)}
                onChange={(e) => {
                  const minutes = Number(e.target.value);
                  if (!minutes || minutes < 1) return;
                  setProposal(
                    (p) => p && { ...p, end: p.start + minutes * 60_000 },
                  );
                }}
                className="w-20 rounded px-2 py-1 text-xs outline-none"
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                }}
                title="Ile minut"
              />
              <span className="text-[10px] muted">min</span>
            </div>

            {proposal.estimated ? (
              <p className="text-[10px] muted">
                Długość oszacowana{proposal.reason ? `: ${proposal.reason}` : ""}
                . Popraw pole obok, jeśli ma być inaczej.
              </p>
            ) : null}

            {proposal.conflicts.length ? (
              <div className="text-[10px]" style={{ color: "var(--warn)" }}>
                W tym czasie już coś jest:{" "}
                {proposal.conflicts
                  .map(
                    (c) =>
                      `${c.title} (${new Date(c.start).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}, ${c.source})`,
                  )
                  .join(", ")}
                . Wysłałem ostrzeżenie na telefon.
              </div>
            ) : null}

            {freeSlots?.length ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] muted">Wolne u wszystkich:</span>
                {freeSlots.map((s) => (
                  <Button
                    key={s.start}
                    onClick={() =>
                      setProposal(
                        (p) =>
                          p && { ...p, start: s.start, end: s.end, conflicts: [] },
                      )
                    }
                  >
                    {new Date(s.start).toLocaleString("pl-PL", {
                      weekday: "short",
                      day: "numeric",
                      month: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Button>
                ))}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-1.5">
              <Button variant="primary" onClick={acceptProposal}>
                {t("Zapisz na wszystkich kontach")}
              </Button>
              <Button
                onClick={async () => {
                  const minutes = Math.round(
                    (proposal.end - proposal.start) / 60_000,
                  );
                  setFreeSlots(undefined);
                  const res = await fetch("/api/calendar", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "slots", minutes }),
                  }).catch(() => undefined);
                  const data = await res?.json().catch(() => undefined);
                  setFreeSlots(data?.slots ?? []);
                }}
                title="Pierwsze okna wolne we wszystkich połączonych kalendarzach"
              >
                {t("Znajdź wolny termin")}
              </Button>
              <Button onClick={() => setProposal(undefined)}>{t("Odrzuć")}</Button>
              <span className="text-[10px] muted">
                {proposal.source === "model"
                  ? "rozpoznane przez model"
                  : "rozpoznane bez modelu"}
              </span>
            </div>
          </div>
        ) : null}

        {allDay.length ? (
          <div className="flex flex-wrap gap-1">
            {allDay.map((e) => (
              <span
                key={e.id}
                className="rounded px-1.5 py-0.5 text-[10px]"
                style={{ background: e.color, color: "#fff" }}
              >
                {e.title}
              </span>
            ))}
          </div>
        ) : null}

        <div
          ref={gridRef}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            if (!dragging) return;
            const start = slotAt(e.clientY);
            const minutes = dragging.estimateMin ?? 60;
            send({
              action: "block",
              title: dragging.title,
              start,
              end: start + minutes * 60_000,
              taskId: dragging.id,
            });
            setDragging(undefined);
          }}
          className="relative overflow-hidden rounded-lg"
          style={{
            background: "var(--panel-2)",
            height: slots.length * SLOT_PX,
          }}
        >
          {slots.map((at, i) => (
            <div
              key={at}
              className="absolute left-0 right-0 flex"
              style={{
                top: i * SLOT_PX,
                height: SLOT_PX,
                borderTop: `1px solid ${i % 2 === 0 ? "var(--border)" : "transparent"}`,
              }}
            >
              {i % 2 === 0 ? (
                <span className="w-10 shrink-0 pl-1 text-[9px] mono muted">
                  {hhmm(at)}
                </span>
              ) : (
                <span className="w-10 shrink-0" />
              )}
            </div>
          ))}

          {withColumns(timed).map((e) => {
            const top =
              ((e.start - (day + START_HOUR * 3_600_000)) /
                (SLOT_MIN * 60_000)) *
              SLOT_PX;
            const height = Math.max(
              SLOT_PX - 2,
              ((e.end - e.start) / (SLOT_MIN * 60_000)) * SLOT_PX - 2,
            );
            if (top < -SLOT_PX) return null;

            // Pas na godziny ma 44 px; resztę dzielimy równo między kolumny.
            const gutter = 44;
            const width = `calc((100% - ${gutter + 4}px) / ${e.columns})`;
            const left = `calc(${gutter}px + ((100% - ${gutter + 4}px) / ${e.columns}) * ${e.column})`;

            return (
              <button
                key={e.id}
                onClick={() => setSelected(e)}
                className="absolute overflow-hidden rounded px-1.5 py-0.5 text-left"
                style={{
                  top: Math.max(0, top),
                  height,
                  left,
                  width,
                  background: e.own
                    ? e.color
                    : `color-mix(in srgb, ${e.color} 22%, transparent)`,
                  borderLeft: `2px solid ${e.color}`,
                  color: e.own ? "#fff" : "var(--text)",
                  // Cieniutka ramka rozdziela sąsiadujące kolumny.
                  outline:
                    selected?.id === e.id
                      ? "1px solid var(--accent)"
                      : "1px solid var(--panel-2)",
                }}
                title={`${e.title}\n${hhmm(e.start)} do ${hhmm(e.end)}\n${e.source}`}
              >
                <div className="truncate text-[10px] font-medium">
                  {e.meetingUrl ? "▸ " : ""}
                  {e.title}
                </div>
                {height > SLOT_PX ? (
                  <div className="truncate text-[9px] opacity-75">
                    {hhmm(e.start)} · {e.source}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>

        {selected ? (
          <div
            className="space-y-1.5 rounded-lg px-3 py-2"
            style={{
              background: "var(--panel-2)",
              border: `1px solid ${selected.color}`,
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold">
                  {selected.title}
                </div>
                <div className="text-[10px] muted">
                  {new Date(selected.start).toLocaleDateString("pl-PL", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                  {selected.allDay
                    ? " · cały dzień"
                    : ` · ${hhmm(selected.start)} do ${hhmm(selected.end)} (${Math.round(
                        (selected.end - selected.start) / 60_000,
                      )} min)`}
                </div>
                <div className="text-[10px] muted">
                  {selected.source}
                  {selected.location ? ` · ${selected.location}` : ""}
                </div>
              </div>
              <Button onClick={() => setSelected(undefined)}>{t("Zamknij")}</Button>
            </div>

            {selected.meetingUrl ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  variant="primary"
                  onClick={() => {
                    const url = selected.meetingUrl;
                    if (!url) return;
                    fetch("/api/open", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ url }),
                    }).catch(() => window.open(url, "_blank", "noopener"));
                  }}
                >
                  {t("Dołącz do spotkania")}
                </Button>
                <span className="truncate text-[10px] muted">
                  {selected.meetingUrl.replace(/^https?:\/\//, "").slice(0, 48)}
                </span>
              </div>
            ) : null}

            {selected.own ? (
              <div className="flex flex-wrap gap-1.5">
                <Button
                  onClick={() => {
                    send({ action: "unblock", id: selected.id });
                    setSelected(undefined);
                  }}
                >
                  {t("Usuń blok")}
                </Button>
                <Button
                  onClick={() =>
                    send({
                      action: "move",
                      id: selected.id,
                      start: selected.start + 15 * 60_000,
                      end: selected.end + 15 * 60_000,
                    })
                  }
                >
                  {t("Przesuń o 15 min")}
                </Button>
              </div>
            ) : (
              <p className="text-[10px] muted">
                Wydarzenie z podłączonego kalendarza; zmienisz je tam, gdzie
                powstało.
              </p>
            )}
          </div>
        ) : null}

        {showSources ? (
          <div
            className="space-y-2 rounded-lg p-2.5"
            style={{ background: "var(--panel-2)" }}
          >
            <p className="text-[10px] muted">
              Wklej prywatny adres ICS. W Google: Ustawienia kalendarza,
              „Prywatny adres w formacie iCal”. W Outlooku: Kalendarz,
              Udostępnianie, Publikuj, link ICS. Adres jest jak hasło, nie
              udostępniaj go dalej.
            </p>
            {sources.map((s) => (
              <div key={s.id} className="flex items-center gap-2 text-[11px]">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: s.color }}
                />
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                {s.lastError ? (
                  <span
                    className="shrink-0 text-[10px]"
                    style={{ color: "var(--err)" }}
                  >
                    {s.lastError.slice(0, 24)}
                  </span>
                ) : s.lastSync ? (
                  <span className="shrink-0 text-[10px] muted">
                    zsynchronizowany
                  </span>
                ) : null}
                <button
                  onClick={() => send({ action: "unsource", id: s.id })}
                  className="shrink-0 text-[10px] underline"
                  style={{ color: "var(--err)" }}
                >
                  usuń
                </button>
              </div>
            ))}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!form.url.trim()) return;
                send({
                  action: "source",
                  source: {
                    name: form.name.trim() || "Kalendarz",
                    url: form.url.trim(),
                    color: sources.length % 2 ? "#0ea5e9" : "#6366f1",
                  },
                });
                setForm({ name: "", url: "" });
              }}
              className="flex flex-wrap gap-1.5"
            >
              <input
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="Nazwa"
                className="w-24 rounded px-2 py-1 text-[11px] outline-none"
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                }}
              />
              <input
                value={form.url}
                onChange={(e) =>
                  setForm((f) => ({ ...f, url: e.target.value }))
                }
                placeholder="https://…/basic.ics"
                className="min-w-0 flex-1 rounded px-2 py-1 text-[11px] outline-none"
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                }}
              />
              <Button variant="primary" type="submit">
                {t("Dodaj")}
              </Button>
            </form>

            <div
              className="space-y-2 border-t pt-2"
              style={{ borderColor: "var(--border)" }}
            >
              <p className="text-[11px] font-semibold">
                Twoje konta, zapis w obie strony
              </p>

              {accounts.map((a) => (
                <div
                  key={a.id}
                  className="flex flex-wrap items-center gap-1.5 rounded px-2 py-1.5 text-[11px]"
                  style={{ background: "var(--panel-2)" }}
                >
                  <span className="w-28 shrink-0 truncate font-semibold">
                    {a.label}
                  </span>
                  <span
                    className="flex-1"
                    style={{
                      color: a.connected
                        ? "var(--ok)"
                        : a.configured
                          ? "var(--warn)"
                          : "var(--muted)",
                    }}
                  >
                    {a.connected
                      ? "połączone, zapis działa"
                      : a.configured
                        ? "dane aplikacji są, brakuje zgody"
                        : "brak danych aplikacji"}
                  </span>

                  {a.configured ? (
                    <Button
                      variant={a.connected ? undefined : "primary"}
                      onClick={() => connectAccount(a.id)}
                    >
                      {a.connected ? "Połącz ponownie" : "Połącz"}
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      onClick={() => {
                        setAppForm((f) => ({ ...f, provider: a.provider }));
                        setShowHow(true);
                        openConsole(a.provider);
                      }}
                    >
                      {t("Skonfiguruj")}
                    </Button>
                  )}

                  <Button onClick={() => openConsole(a.provider)}>
                    {a.provider === "google" ? "Konsola Google" : "Portal Azure"}
                  </Button>

                  {a.configured ? (
                    <Button
                      onClick={() => send({ action: "disconnect", provider: a.id })}
                      title="Usuwa tokeny i dane aplikacji z sejfu"
                    >
                      {t("Odłącz")}
                    </Button>
                  ) : null}
                </div>
              ))}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!appForm.clientId.trim() || !appForm.clientSecret.trim())
                    return;
                  send({
                    action: "config",
                    // Etykieta rozróżnia konta tego samego dostawcy.
                    provider: appForm.label.trim()
                      ? `${appForm.provider}:${appForm.label.trim()}`
                      : appForm.provider,
                    config: {
                      clientId: appForm.clientId.trim(),
                      clientSecret: appForm.clientSecret.trim(),
                      tenant: appForm.tenant.trim() || undefined,
                    },
                  });
                  setAppForm({
                    provider: appForm.provider,
                    label: "",
                    clientId: "",
                    clientSecret: "",
                    tenant: "",
                  });
                }}
                className="flex flex-wrap gap-1.5"
              >
                <select
                  value={appForm.provider}
                  onChange={(e) =>
                    setAppForm((f) => ({ ...f, provider: e.target.value }))
                  }
                  className="rounded px-1.5 py-1 text-[11px]"
                  style={{
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <option value="google">Google</option>
                  <option value="microsoft">Microsoft</option>
                </select>
                <input
                  value={appForm.label}
                  onChange={(e) =>
                    setAppForm((f) => ({ ...f, label: e.target.value }))
                  }
                  placeholder="nazwa konta, np. firmowe"
                  className="w-36 rounded px-2 py-1 text-[11px] outline-none"
                  style={{
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                  }}
                  title="Puste znaczy konto domyślne tego dostawcy"
                />
                <input
                  value={appForm.clientId}
                  onChange={(e) =>
                    setAppForm((f) => ({ ...f, clientId: e.target.value }))
                  }
                  placeholder="identyfikator klienta"
                  className="min-w-0 flex-1 rounded px-2 py-1 text-[11px] outline-none"
                  style={{
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                  }}
                />
                <input
                  value={appForm.clientSecret}
                  onChange={(e) =>
                    setAppForm((f) => ({ ...f, clientSecret: e.target.value }))
                  }
                  type="password"
                  placeholder="klucz tajny"
                  className="min-w-0 flex-1 rounded px-2 py-1 text-[11px] outline-none"
                  style={{
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                  }}
                />
                {appForm.provider === "microsoft" ? (
                  <input
                    value={appForm.tenant}
                    onChange={(e) =>
                      setAppForm((f) => ({ ...f, tenant: e.target.value }))
                    }
                    placeholder="identyfikator katalogu (albo common)"
                    className="w-52 rounded px-2 py-1 text-[11px] outline-none"
                    style={{
                      background: "var(--bg)",
                      border: "1px solid var(--border)",
                    }}
                  />
                ) : null}
                <Button variant="primary" type="submit">
                  {t("Zapisz w sejfie")}
                </Button>
              </form>

              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="muted shrink-0">Adres powrotny:</span>
                <span className="mono truncate flex-1">{redirect}</span>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(redirect).catch(() => undefined);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="shrink-0 underline"
                  style={{ color: "var(--accent)" }}
                >
                  {copied ? "skopiowano" : "kopiuj"}
                </button>
              </div>

              <button
                onClick={() => setShowHow((v) => !v)}
                className="text-[10px] underline muted"
              >
                {showHow ? "ukryj instrukcję" : "jak zdobyć te dane"}
              </button>

              {showHow ? (
                <ol className="space-y-1 pl-4 text-[10px] muted list-decimal">
                  {appForm.provider === "google" ? (
                    <>
                      <li>
                        W konsoli Google Cloud załóż projekt i włącz Google
                        Calendar API.
                      </li>
                      <li>
                        Ekran zgody: typ zewnętrzny, dodaj siebie jako testera.
                      </li>
                      <li>
                        Dane logowania: identyfikator klienta OAuth, typ
                        aplikacja internetowa.
                      </li>
                      <li>
                        Jako autoryzowany URI przekierowania wklej adres
                        powrotny powyżej.
                      </li>
                      <li>
                        Skopiuj identyfikator i klucz tajny do pól wyżej, zapisz
                        i kliknij „połącz”.
                      </li>
                    </>
                  ) : (
                    <>
                      <li>
                        W Azure, Microsoft Entra ID, rejestracja aplikacji, nowa
                        rejestracja.
                      </li>
                      <li>
                        Typ przekierowania: sieć Web, adres jak powyżej.
                      </li>
                      <li>
                        Uprawnienia API, Microsoft Graph, delegowane:
                        Calendars.ReadWrite i offline_access.
                      </li>
                      <li>
                        Certyfikaty i klucze tajne: nowy klucz tajny klienta,
                        skopiuj wartość od razu.
                      </li>
                      <li>
                        Identyfikator katalogu weź z przeglądu aplikacji, albo
                        wpisz „common” dla kont prywatnych.
                      </li>
                    </>
                  )}
                </ol>
              ) : null}

              <p className="text-[10px] muted">
                Dane trafiają do zaszyfrowanego sejfu panelu, każdy zestaw jest
                osobny dla konta, na którym panel działa. Łącząc się z telefonu,
                dopisz u dostawcy także adres powrotny z tego hosta.
              </p>
            </div>

            <p className="text-[10px] muted">
              Bez podłączonego konta w drugą stronę: zasubskrybuj{" "}
              <span className="mono">
                http://localhost:4317/api/calendar/export
              </span>
              , żeby bloki z panelu pojawiły się w Twoim kalendarzu.
            </p>
          </div>
        ) : null}
      </div>

      <div className="space-y-2">
        <h3 className="text-[10px] font-semibold muted">
          PRZECIĄGNIJ ZADANIE NA GODZINĘ
        </h3>
        <div className="max-h-[60vh] space-y-1 overflow-y-auto pr-1">
          {tasks.map((t) => (
            <div
              key={t.id}
              draggable
              onDragStart={() => setDragging(t)}
              onDragEnd={() => setDragging(undefined)}
              className="cursor-grab rounded px-2 py-1.5 text-[11px] active:cursor-grabbing"
              style={{
                background: "var(--panel-2)",
                opacity: dragging?.id === t.id ? 0.4 : 1,
              }}
            >
              <div className="truncate">{t.title}</div>
              <div className="text-[9px] muted">
                {t.estimateMin ? `${t.estimateMin} min` : "60 min domyślnie"}
                {t.project ? ` · ${t.project}` : ""}
              </div>
            </div>
          ))}
          {tasks.length === 0 ? (
            <p className="py-4 text-center text-[10px] muted">
              Brak otwartych zadań.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
