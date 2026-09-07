"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui";

type Event = {
  id: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  source: string;
  color: string;
  location?: string;
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
export function CalendarPanel() {
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
  const [appForm, setAppForm] = useState({
    provider: "google",
    clientId: "",
    clientSecret: "",
    tenant: "",
  });
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
    if (todo) setTasks((todo.items as Task[]).slice(0, 20));
  }, [day]);

  useEffect(() => {
    load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, [load]);

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
          <Button onClick={() => setShowSources((v) => !v)}>
            {showSources ? "Ukryj źródła" : `Źródła (${sources.length})`}
          </Button>
        </div>

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

          {timed.map((e) => {
            const top =
              ((e.start - (day + START_HOUR * 3_600_000)) /
                (SLOT_MIN * 60_000)) *
              SLOT_PX;
            const height = Math.max(
              SLOT_PX - 2,
              ((e.end - e.start) / (SLOT_MIN * 60_000)) * SLOT_PX - 2,
            );
            if (top < -SLOT_PX) return null;
            return (
              <div
                key={e.id}
                className="absolute left-11 right-1 overflow-hidden rounded px-1.5 py-0.5"
                style={{
                  top: Math.max(0, top),
                  height,
                  background: e.own
                    ? e.color
                    : `color-mix(in srgb, ${e.color} 22%, transparent)`,
                  borderLeft: `2px solid ${e.color}`,
                  color: e.own ? "#fff" : "var(--text)",
                }}
                title={`${e.title}\n${hhmm(e.start)} do ${hhmm(e.end)}\n${e.source}${
                  e.location ? `\n${e.location}` : ""
                }`}
              >
                <div className="truncate text-[10px] font-medium">
                  {e.title}
                </div>
                <div className="truncate text-[9px] opacity-75">
                  {hhmm(e.start)} · {e.source}
                </div>
                {e.own ? (
                  <button
                    onClick={() => send({ action: "unblock", id: e.id })}
                    className="absolute right-1 top-0 text-[10px] opacity-70"
                    title="Usuń blok"
                  >
                    ✕
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

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
                Dodaj
              </Button>
            </form>

            <div className="space-y-1.5 border-t pt-2" style={{ borderColor: "var(--border)" }}>
              <p className="text-[11px] font-semibold">Konta z zapisem w obie strony</p>
              {(["google", "microsoft"] as const).map((p) => (
                <div key={p} className="flex items-center gap-2 text-[11px]">
                  <span className="w-20 shrink-0">
                    {p === "google" ? "Google" : "Outlook"}
                  </span>
                  <span
                    className="flex-1"
                    style={{
                      color: connections[p]?.connected
                        ? "var(--ok)"
                        : connections[p]?.configured
                          ? "var(--warn)"
                          : "var(--muted)",
                    }}
                  >
                    {connections[p]?.connected
                      ? "połączone, zapis działa"
                      : connections[p]?.configured
                        ? "dane aplikacji są, brakuje zgody"
                        : "brak danych aplikacji"}
                  </span>
                  {connections[p]?.configured ? (
                    <a
                      href={`/api/calendar/oauth/${p}`}
                      className="shrink-0 underline"
                      style={{ color: "var(--accent)" }}
                    >
                      {connections[p]?.connected ? "połącz ponownie" : "połącz"}
                    </a>
                  ) : null}
                </div>
              ))}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!appForm.clientId.trim() || !appForm.clientSecret.trim()) return;
                  send({
                    action: "config",
                    provider: appForm.provider,
                    config: {
                      clientId: appForm.clientId.trim(),
                      clientSecret: appForm.clientSecret.trim(),
                      tenant: appForm.tenant.trim() || undefined,
                    },
                  });
                  setAppForm({ provider: appForm.provider, clientId: "", clientSecret: "", tenant: "" });
                }}
                className="flex flex-wrap gap-1.5"
              >
                <select
                  value={appForm.provider}
                  onChange={(e) => setAppForm((f) => ({ ...f, provider: e.target.value }))}
                  className="rounded px-1.5 py-1 text-[11px]"
                  style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
                >
                  <option value="google">Google</option>
                  <option value="microsoft">Microsoft</option>
                </select>
                <input
                  value={appForm.clientId}
                  onChange={(e) => setAppForm((f) => ({ ...f, clientId: e.target.value }))}
                  placeholder="identyfikator klienta"
                  className="min-w-0 flex-1 rounded px-2 py-1 text-[11px] outline-none"
                  style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
                />
                <input
                  value={appForm.clientSecret}
                  onChange={(e) => setAppForm((f) => ({ ...f, clientSecret: e.target.value }))}
                  type="password"
                  placeholder="klucz tajny"
                  className="min-w-0 flex-1 rounded px-2 py-1 text-[11px] outline-none"
                  style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
                />
                {appForm.provider === "microsoft" ? (
                  <input
                    value={appForm.tenant}
                    onChange={(e) => setAppForm((f) => ({ ...f, tenant: e.target.value }))}
                    placeholder="identyfikator katalogu"
                    className="w-40 rounded px-2 py-1 text-[11px] outline-none"
                    style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
                  />
                ) : null}
                <Button variant="primary" type="submit">
                  Zapisz w sejfie
                </Button>
              </form>
              <p className="text-[10px] muted">
                Dane trafiają do zaszyfrowanego sejfu panelu. Przekierowanie do wpisania w konsoli:{" "}
                <span className="mono">
                  http://localhost:4317/api/calendar/oauth/{appForm.provider}
                </span>
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
