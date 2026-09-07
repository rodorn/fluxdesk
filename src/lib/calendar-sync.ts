import {
  accessToken,
  listAccounts,
  splitAccount,
  type AccountId,
  type Provider,
} from "./calendar-oauth";
import { findMeetingUrl, type CalendarEvent } from "./calendar";

/**
 * Dwukierunkowa wymiana z Google Calendar i Microsoft Graph. Odczyt daje
 * wydarzenia obok tych z ICS, a zapis wysyła bloki założone w panelu, więc
 * zaplanowany czas widać także na telefonie i w kalendarzu firmowym.
 */

export type RemoteEvent = CalendarEvent & {
  provider: Provider;
  /** Z którego konta pochodzi; przy kilku kontach naraz to jedyne rozróżnienie. */
  account: AccountId;
  /** Identyfikator po stronie dostawcy; potrzebny do zmian i usunięcia. */
  remoteId: string;
};

const COLORS: Record<Provider, string> = {
  google: "#0ea5e9",
  microsoft: "#f43f5e",
};

const LABEL: Record<Provider, string> = {
  google: "Google",
  microsoft: "Outlook",
};

async function call(
  account: AccountId,
  path: string,
  init?: RequestInit,
): Promise<Response | undefined> {
  const token = await accessToken(account);
  if (!token) return undefined;

  const { provider } = splitAccount(account);
  const base =
    provider === "google"
      ? "https://www.googleapis.com/calendar/v3"
      : "https://graph.microsoft.com/v1.0/me";

  try {
    return await fetch(base + path, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------ */
/* Odczyt                                                              */
/* ------------------------------------------------------------------ */

type GoogleEvent = {
  id: string;
  summary?: string;
  location?: string;
  description?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
};

type GraphEvent = {
  id: string;
  subject?: string;
  location?: { displayName?: string };
  onlineMeeting?: { joinUrl?: string };
  onlineMeetingUrl?: string;
  body?: { content?: string };
  isAllDay?: boolean;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  singleValueExtendedProperties?: { id: string; value: string }[];
};

/** Graph podaje czas bez strefy, więc doklejamy Z, gdy zapis jest w UTC. */
function graphDate(value?: string, zone?: string): number | undefined {
  if (!value) return undefined;
  const iso = /Z$|[+-]\d{2}:\d{2}$/.test(value)
    ? value
    : `${value}${zone === "UTC" || !zone ? "Z" : ""}`;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? undefined : at;
}

export async function fetchRemote(
  from: number,
  to: number,
  only?: AccountId[],
): Promise<RemoteEvent[]> {
  const accounts = (await listAccounts()).filter(
    (a) => a.connected && (!only || only.includes(a.id)),
  );
  const perAccount = await Promise.all(
    accounts.map((a) => fetchOne(a.id, from, to).catch(() => [])),
  );
  return perAccount.flat();
}

/** Pobranie z jednego konta; osobno, żeby awaria jednego nie psuła reszty. */
async function fetchOne(
  account: AccountId,
  from: number,
  to: number,
): Promise<RemoteEvent[]> {
  const { provider, label } = splitAccount(account);
  const out: RemoteEvent[] = [];

  if (provider === "google") {
    const google = await call(
      account,
      `/calendars/primary/events?timeMin=${new Date(from).toISOString()}` +
        `&timeMax=${new Date(to).toISOString()}&singleEvents=true&orderBy=startTime&maxResults=250`,
    );
    if (google?.ok) {
      const data = (await google.json()) as { items?: GoogleEvent[] };
      for (const e of data.items ?? []) {
        const allDay = Boolean(e.start?.date);
        const start = e.start?.dateTime
          ? Date.parse(e.start.dateTime)
          : e.start?.date
            ? new Date(`${e.start.date}T00:00:00`).getTime()
            : undefined;
        const end = e.end?.dateTime
          ? Date.parse(e.end.dateTime)
          : e.end?.date
            ? new Date(`${e.end.date}T00:00:00`).getTime()
            : undefined;
        if (!start || !end) continue;

        out.push({
          id: `${account}:${e.id}`,
          remoteId: e.id,
          provider,
          account,
          title: e.summary ?? "(bez nazwy)",
          start,
          end,
          allDay,
          source: label,
          color: COLORS.google,
          location: e.location,
          // Google podaje adres spotkania osobnym polem; reszta w opisie.
          meetingUrl:
            e.hangoutLink ??
            e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")
              ?.uri ??
            findMeetingUrl(e.location, e.description),
          taskId: e.extendedProperties?.private?.fluxdeskTask,
        });
      }
    }
    return out;
  }

  const graph = await call(
    account,
    `/calendarView?startDateTime=${new Date(from).toISOString()}` +
      `&endDateTime=${new Date(to).toISOString()}&$top=250&$orderby=start/dateTime`,
    { headers: { Prefer: 'outlook.timezone="UTC"' } },
  );
  if (graph?.ok) {
    const data = (await graph.json()) as { value?: GraphEvent[] };
    for (const e of data.value ?? []) {
      const start = graphDate(e.start?.dateTime, e.start?.timeZone);
      const end = graphDate(e.end?.dateTime, e.end?.timeZone);
      if (!start || !end) continue;

      out.push({
        id: `${account}:${e.id}`,
        remoteId: e.id,
        provider,
        account,
        title: e.subject ?? "(bez nazwy)",
        start,
        end,
        allDay: Boolean(e.isAllDay),
        source: label,
        color: COLORS.microsoft,
        location: e.location?.displayName,
        meetingUrl:
          e.onlineMeeting?.joinUrl ??
          e.onlineMeetingUrl ??
          findMeetingUrl(e.location?.displayName, e.body?.content),
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Zapis                                                               */
/* ------------------------------------------------------------------ */

/**
 * Wysyła blok do kalendarza dostawcy. Zwraca identyfikator zdalny, po którym
 * później rozpoznajemy to samo wydarzenie przy zmianie albo usunięciu.
 */
export async function pushBlock(
  account: AccountId,
  block: {
    title: string;
    start: number;
    end: number;
    taskId?: string;
    remoteId?: string;
  },
): Promise<string | undefined> {
  const { provider } = splitAccount(account);
  if (provider === "google") {
    const body = {
      summary: block.title,
      start: { dateTime: new Date(block.start).toISOString() },
      end: { dateTime: new Date(block.end).toISOString() },
      // Znacznik pozwala rozpoznać własne wpisy przy odczycie.
      extendedProperties: {
        private: { fluxdesk: "1", fluxdeskTask: block.taskId ?? "" },
      },
    };
    const res = block.remoteId
      ? await call(account, `/calendars/primary/events/${block.remoteId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        })
      : await call(account, "/calendars/primary/events", {
          method: "POST",
          body: JSON.stringify(body),
        });
    if (!res?.ok) return undefined;
    return ((await res.json()) as { id?: string }).id;
  }

  const body = {
    subject: block.title,
    start: {
      dateTime: new Date(block.start).toISOString().replace("Z", ""),
      timeZone: "UTC",
    },
    end: {
      dateTime: new Date(block.end).toISOString().replace("Z", ""),
      timeZone: "UTC",
    },
    categories: ["Fluxdesk"],
  };
  const res = block.remoteId
    ? await call(account, `/events/${block.remoteId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      })
    : await call(account, "/events", {
        method: "POST",
        body: JSON.stringify(body),
      });
  if (!res?.ok) return undefined;
  return ((await res.json()) as { id?: string }).id;
}

export async function deleteRemote(
  account: AccountId,
  remoteId: string,
): Promise<boolean> {
  const { provider } = splitAccount(account);
  const path =
    provider === "google"
      ? `/calendars/primary/events/${remoteId}`
      : `/events/${remoteId}`;
  const res = await call(account, path, { method: "DELETE" });
  return Boolean(res && (res.ok || res.status === 404));
}
