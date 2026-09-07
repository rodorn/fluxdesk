"use client";

import { useCallback, useEffect, useState } from "react";

import { Button, ErrorText, Field, Input } from "@/components/ui";

type Settings = {
  enabled: boolean;
  server: string;
  topic: string;
  onPermission: boolean;
  onFinish: boolean;
  onError: boolean;
};

/** Losowy temat, żeby nikt przypadkiem nie trafił na twoje powiadomienia. */
function randomTopic(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return (
    "fluxdesk-" +
    Array.from(bytes, (b) => b.toString(36))
      .join("")
      .slice(0, 14)
  );
}

export function NotifyPanel() {
  const [s, setS] = useState<Settings>();
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    const res = await fetch("/api/notify");
    const data = await res.json();
    if (res.ok) setS(data as Settings);
    else setError(data.error);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(next: Partial<Settings>) {
    const res = await fetch("/api/notify", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    const data = await res.json();
    if (res.ok) setS(data as Settings);
    else setError(data.error);
  }

  async function test() {
    setStatus("Wysyłam…");
    const res = await fetch("/api/notify", { method: "POST" });
    const data = await res.json();
    setStatus(
      data.sent ? "Wysłane, sprawdź telefon" : `Nie wysłano: ${data.reason}`,
    );
  }

  if (!s)
    return <p className="py-10 text-center text-sm muted">Wczytywanie…</p>;

  return (
    <div className="max-w-xl space-y-3">
      <p className="text-[11px] muted">
        Powiadomienia idą przez ntfy, bo Web Push wymaga bezpiecznego
        połączenia, a panel w sieci domowej działa po http. Zainstaluj aplikację
        ntfy na telefonie, dodaj poniższy temat i gotowe. Wysyłamy tylko nazwę
        sesji i nazwę narzędzia, nigdy treści rozmowy, ale pamiętaj: kto zna
        temat, ten widzi te powiadomienia.
      </p>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={s.enabled}
          onChange={(e) => patch({ enabled: e.target.checked })}
        />
        Włącz powiadomienia na telefon
      </label>

      <Field label="Serwer" hint="Publiczny ntfy.sh albo własny">
        <Input
          value={s.server}
          onChange={(e) => patch({ server: e.target.value })}
        />
      </Field>

      <Field label="Temat" hint="Traktuj jak hasło, nie udostępniaj">
        <div className="flex gap-2">
          <Input
            value={s.topic}
            onChange={(e) => patch({ topic: e.target.value })}
          />
          <Button onClick={() => patch({ topic: randomTopic() })}>Losuj</Button>
        </div>
      </Field>

      <div className="space-y-1">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={s.onPermission}
            onChange={(e) => patch({ onPermission: e.target.checked })}
          />
          gdy sesja czeka na zgodę
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={s.onError}
            onChange={(e) => patch({ onError: e.target.checked })}
          />
          gdy sesja zgłosi błąd
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={s.onFinish}
            onChange={(e) => patch({ onFinish: e.target.checked })}
          />
          gdy sesja skończy turę
        </label>
      </div>

      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          onClick={test}
          disabled={!s.enabled || !s.topic.trim()}
        >
          Wyślij próbne
        </Button>
        <span className="text-[11px] muted">{status}</span>
      </div>

      {s.topic ? (
        <p className="text-[10px] muted">
          Na telefonie subskrybuj:{" "}
          <span className="mono">
            {s.server}/{s.topic}
          </span>
        </p>
      ) : null}

      <ErrorText>{error}</ErrorText>
    </div>
  );
}
