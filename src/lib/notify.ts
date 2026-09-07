import { mutateStore, readStore } from "./store";

/**
 * Powiadomienia na telefon. Web Push wymaga bezpiecznego połączenia, a panel
 * działa w sieci lokalnej po http, więc korzystamy z ntfy: panel wysyła
 * zwykłego POST-a, a aplikacja na telefonie odbiera go natychmiast.
 *
 * Domyślnie wyłączone. Po włączeniu treść wychodzi na wskazany serwer, dlatego
 * wysyłamy tylko nazwę sesji i nazwę narzędzia, nigdy zawartości rozmowy.
 */

export type NotifySettings = {
  enabled: boolean;
  /** Serwer ntfy; domyślnie publiczny. Można wskazać własny. */
  server: string;
  /** Temat, na który wysyłamy. Traktuj jak hasło: kto go zna, ten czyta. */
  topic: string;
  /** Powiadamiać, gdy sesja czeka na zgodę. */
  onPermission: boolean;
  /** Powiadamiać, gdy sesja skończy turę. */
  onFinish: boolean;
  /** Powiadamiać o błędach sesji. */
  onError: boolean;
};

export const DEFAULT_NOTIFY: NotifySettings = {
  enabled: false,
  server: "https://ntfy.sh",
  topic: "",
  onPermission: true,
  onFinish: false,
  onError: true,
};

type StoreWithNotify = Awaited<ReturnType<typeof readStore>> & {
  notify?: NotifySettings;
};

export async function readNotifySettings(): Promise<NotifySettings> {
  const store = (await readStore()) as StoreWithNotify;
  return { ...DEFAULT_NOTIFY, ...(store.notify ?? {}) };
}

export async function writeNotifySettings(
  patch: Partial<NotifySettings>,
): Promise<NotifySettings> {
  return mutateStore((data) => {
    const current = {
      ...DEFAULT_NOTIFY,
      ...((data as StoreWithNotify).notify ?? {}),
    };
    const next = { ...current, ...patch };
    (data as StoreWithNotify).notify = next;
    return next;
  });
}

export type NotifyInput = {
  title: string;
  message: string;
  /** Wyższy priorytet przebija tryb cichy na telefonie. */
  priority?: 1 | 2 | 3 | 4 | 5;
  tags?: string[];
};

/** Wysyła powiadomienie, o ile jest włączone i skonfigurowane. */
export async function notify(
  input: NotifyInput,
): Promise<{ sent: boolean; reason?: string }> {
  const settings = await readNotifySettings();
  if (!settings.enabled) return { sent: false, reason: "wyłączone" };
  if (!settings.topic.trim()) return { sent: false, reason: "brak tematu" };

  // Ciche godziny: telefon nie musi wibrować w nocy ani w trakcie terapii.
  // Sprawy pilne (priorytet 4 i wyżej) przechodzą mimo to.
  try {
    const { attentionReport } = await import("./attention");
    const report = await attentionReport();
    if (report.quietNow && (input.priority ?? 3) < 4) {
      return { sent: false, reason: "ciche godziny" };
    }
  } catch {
    /* brak ustawień uwagi nie może blokować powiadomień */
  }

  try {
    const res = await fetch(
      `${settings.server.replace(/\/$/, "")}/${settings.topic.trim()}`,
      {
        method: "POST",
        headers: {
          Title: encodeURIComponent(input.title),
          Priority: String(input.priority ?? 3),
          ...(input.tags?.length ? { Tags: input.tags.join(",") } : {}),
        },
        body: input.message,
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok)
      return { sent: false, reason: `serwer odpowiedział ${res.status}` };
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
