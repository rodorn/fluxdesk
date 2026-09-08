"use client";

import { useEffect, useState } from "react";

import { CalendarAccounts } from "@/components/deck/CalendarAccounts";
import { NotifyPanel } from "@/components/deck/NotifyPanel";
import { ProfilePanel } from "@/components/deck/ProfilePanel";
import { RulesPanel } from "@/components/deck/RulesPanel";
import { SecretsPanel } from "@/components/deck/SecretsPanel";
import { Button } from "@/components/ui";
import { useLang, type Lang } from "@/lib/i18n";

/**
 * Jedno miejsce na ustawienia. Wcześniej język, powiadomienia, zgody i sejf
 * mieszkały w różnych zakątkach panelu; szukanie ich zajmowało więcej czasu niż
 * sama zmiana.
 */

type Tab = "ogolne" | "powiadomienia" | "zgody" | "sejf" | "profil";

export function SettingsPanel({
  onOpenCalendar,
}: {
  onOpenCalendar?: () => void;
}) {
  const { lang, setLang, t } = useLang();
  const [tab, setTab] = useState<Tab>("ogolne");
  const [version, setVersion] = useState<string>();

  useEffect(() => {
    fetch("/api/version")
      .then((r) => (r.ok ? r.json() : undefined))
      .then((d) => d && setVersion(d.version ?? d.commit))
      .catch(() => undefined);
  }, []);

  const tabs: { id: Tab; label: string }[] = [
    { id: "ogolne", label: t("Ogólne") },
    { id: "powiadomienia", label: t("Powiadomienia") },
    { id: "zgody", label: t("Zgody") },
    { id: "sejf", label: t("Sejf") },
    { id: "profil", label: t("O mnie") },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {tabs.map((x) => (
          <button
            key={x.id}
            onClick={() => setTab(x.id)}
            className="rounded-lg px-3 py-1.5 text-xs font-medium"
            style={{
              background: tab === x.id ? "var(--accent)" : "var(--panel-2)",
              color: tab === x.id ? "#fff" : "var(--text)",
            }}
          >
            {x.label}
          </button>
        ))}
      </div>

      {tab === "ogolne" ? (
        <div className="space-y-3">
          <section
            className="space-y-2 rounded-lg px-3 py-2.5"
            style={{ background: "var(--panel-2)" }}
          >
            <p className="text-xs font-semibold">{t("Język interfejsu")}</p>
            <div className="flex gap-1.5">
              {(
                [
                  ["pl", "Polski"],
                  ["en", "English"],
                ] as [Lang, string][]
              ).map(([id, label]) => (
                <Button
                  key={id}
                  variant={lang === id ? "primary" : undefined}
                  onClick={() => setLang(id)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <p className="text-[10px] muted">
              {t(
                "Wybór zostaje w tej przeglądarce. Napisy bez tłumaczenia zostają po polsku.",
              )}
            </p>
          </section>

          <section
            className="space-y-2 rounded-lg px-3 py-2.5"
            style={{ background: "var(--panel-2)" }}
          >
            <p className="text-xs font-semibold">{t("Kalendarze")}</p>
            <CalendarAccounts />
            {onOpenCalendar ? (
              <Button onClick={onOpenCalendar}>{t("Otwórz kalendarz")}</Button>
            ) : null}
          </section>

          <section
            className="space-y-1 rounded-lg px-3 py-2.5"
            style={{ background: "var(--panel-2)" }}
          >
            <p className="text-xs font-semibold">{t("O programie")}</p>
            <p className="text-[10px] muted">
              Fluxdesk{version ? ` · ${version}` : ""}
            </p>
            <button
              onClick={() =>
                fetch("/api/open", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    url: "https://github.com/rodorn/fluxdesk",
                  }),
                }).catch(() => undefined)
              }
              className="text-[10px] underline"
              style={{ color: "var(--accent)" }}
            >
              github.com/rodorn/fluxdesk
            </button>
          </section>
        </div>
      ) : null}

      {tab === "powiadomienia" ? <NotifyPanel /> : null}
      {tab === "zgody" ? <RulesPanel /> : null}
      {tab === "sejf" ? <SecretsPanel /> : null}
      {tab === "profil" ? <ProfilePanel /> : null}
    </div>
  );
}
