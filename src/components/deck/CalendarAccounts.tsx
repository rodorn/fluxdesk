"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui";
import { useLang } from "@/lib/i18n";

/**
 * Podpinanie kalendarzy Google i Microsoftu. Mieszka w ustawieniach, nie w
 * samym kalendarzu: konto podłącza się raz, a potem chce się tylko patrzeć na
 * dzień, nie na formularze.
 */

type Account = {
  id: string;
  provider: "google" | "microsoft";
  label: string;
  configured: boolean;
  connected: boolean;
};

const CONSOLES: Record<string, string> = {
  google: "https://console.cloud.google.com/auth/clients/create",
  microsoft:
    "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/CreateApplicationBlade",
};

function openExternal(url: string) {
  fetch("/api/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  }).catch(() => window.open(url, "_blank", "noopener"));
}

export function CalendarAccounts() {
  const { t } = useLang();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showHow, setShowHow] = useState(false);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({
    provider: "google",
    label: "",
    clientId: "",
    clientSecret: "",
    tenant: "",
  });

  const load = useCallback(async () => {
    const data = await fetch("/api/calendar?view=sources")
      .then((r) => (r.ok ? r.json() : undefined))
      .catch(() => undefined);
    if (data?.accounts) setAccounts(data.accounts as Account[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const redirect =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/api/calendar/oauth/${form.provider}`;

  async function send(body: Record<string, unknown>) {
    await fetch("/api/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => undefined);
    load();
  }

  /** Zgoda otwiera się w zwykłej przeglądarce, panel tylko dopytuje o wynik. */
  function connect(id: string) {
    const provider = id.split(":")[0];
    openExternal(
      `${window.location.origin}/api/calendar/oauth/${provider}?state=${encodeURIComponent(id)}`,
    );
    let tries = 0;
    const timer = setInterval(() => {
      load();
      if (++tries > 20) clearInterval(timer);
    }, 3000);
  }

  return (
    <div className="space-y-2">
      {accounts.map((a) => (
        <div
          key={a.id}
          className="flex flex-wrap items-center gap-1.5 rounded px-2 py-1.5 text-[11px]"
          style={{ background: "var(--bg)" }}
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
              ? t("połączone, zapis działa")
              : a.configured
                ? t("dane aplikacji są, brakuje zgody")
                : t("brak danych aplikacji")}
          </span>

          {a.configured ? (
            <Button
              variant={a.connected ? undefined : "primary"}
              onClick={() => connect(a.id)}
            >
              {a.connected ? t("Połącz ponownie") : t("Połącz")}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => {
                setForm((f) => ({ ...f, provider: a.provider }));
                setShowHow(true);
                openExternal(CONSOLES[a.provider]);
              }}
            >
              {t("Skonfiguruj")}
            </Button>
          )}

          <Button onClick={() => openExternal(CONSOLES[a.provider])}>
            {a.provider === "google" ? t("Konsola Google") : t("Portal Azure")}
          </Button>

          {a.configured ? (
            <Button
              onClick={() => send({ action: "disconnect", provider: a.id })}
              title={t("Usuwa tokeny i dane aplikacji z sejfu")}
            >
              {t("Odłącz")}
            </Button>
          ) : null}
        </div>
      ))}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.clientId.trim() || !form.clientSecret.trim()) return;
          send({
            action: "config",
            provider: form.label.trim()
              ? `${form.provider}:${form.label.trim()}`
              : form.provider,
            config: {
              clientId: form.clientId.trim(),
              clientSecret: form.clientSecret.trim(),
              tenant: form.tenant.trim() || undefined,
            },
          });
          setForm({
            ...form,
            label: "",
            clientId: "",
            clientSecret: "",
            tenant: "",
          });
        }}
        className="flex flex-wrap gap-1.5"
      >
        <select
          value={form.provider}
          onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
          className="rounded px-1.5 py-1 text-[11px]"
          style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
        >
          <option value="google">Google</option>
          <option value="microsoft">Microsoft</option>
        </select>
        <input
          value={form.label}
          onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
          placeholder={t("nazwa konta, np. firmowe")}
          className="w-36 rounded px-2 py-1 text-[11px] outline-none"
          style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
        />
        <input
          value={form.clientId}
          onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}
          placeholder={t("identyfikator klienta")}
          className="min-w-0 flex-1 rounded px-2 py-1 text-[11px] outline-none"
          style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
        />
        <input
          value={form.clientSecret}
          onChange={(e) =>
            setForm((f) => ({ ...f, clientSecret: e.target.value }))
          }
          type="password"
          placeholder={t("klucz tajny")}
          className="min-w-0 flex-1 rounded px-2 py-1 text-[11px] outline-none"
          style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
        />
        {form.provider === "microsoft" ? (
          <input
            value={form.tenant}
            onChange={(e) => setForm((f) => ({ ...f, tenant: e.target.value }))}
            placeholder={t("identyfikator katalogu (albo common)")}
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
        <span className="muted shrink-0">{t("Adres powrotny:")}</span>
        <span className="mono flex-1 truncate">{redirect}</span>
        <button
          onClick={() => {
            navigator.clipboard?.writeText(redirect).catch(() => undefined);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="shrink-0 underline"
          style={{ color: "var(--accent)" }}
        >
          {copied ? t("skopiowano") : t("kopiuj")}
        </button>
      </div>

      <button
        onClick={() => setShowHow((v) => !v)}
        className="text-[10px] underline muted"
      >
        {showHow ? t("ukryj instrukcję") : t("jak zdobyć te dane")}
      </button>

      {showHow ? (
        <ol className="list-decimal space-y-1 pl-4 text-[10px] muted">
          {form.provider === "google" ? (
            <>
              <li>W konsoli Google Cloud włącz Google Calendar API.</li>
              <li>Ekran zgody: typ zewnętrzny, dodaj siebie jako testera.</li>
              <li>
                Dane logowania, identyfikator klienta OAuth, typ aplikacja
                internetowa.
              </li>
              <li>Jako URI przekierowania wklej adres powrotny powyżej.</li>
              <li>Skopiuj identyfikator i klucz tajny do pól wyżej.</li>
            </>
          ) : (
            <>
              <li>
                Microsoft Entra ID, rejestracja aplikacji, nowa rejestracja.
              </li>
              <li>Przekierowanie typu Web, adres jak powyżej.</li>
              <li>
                Certyfikaty i klucze tajne, nowy klucz, skopiuj wartość od razu.
              </li>
              <li>
                Identyfikator katalogu z przeglądu aplikacji, albo „common" dla
                kont prywatnych.
              </li>
            </>
          )}
        </ol>
      ) : null}

      <p className="text-[10px] muted">
        {t(
          "Dane trafiają do zaszyfrowanego sejfu panelu. Łącząc się z telefonu, dopisz u dostawcy także adres powrotny z tego hosta.",
        )}
      </p>
    </div>
  );
}
