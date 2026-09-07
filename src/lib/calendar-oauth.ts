import { revealSecret, saveSecret } from "./secrets";

/**
 * Logowanie do kalendarzy Google i Microsoftu. Dane aplikacji oraz tokeny żyją
 * w sejfie panelu, więc nie ma ich w kodzie ani w plikach konfiguracyjnych.
 *
 * Świadomie używamy przepływu z odświeżaniem: panel działa jako usługa i musi
 * pracować także wtedy, gdy nikogo nie ma przy komputerze.
 */

export type Provider = "google" | "microsoft";

export type ProviderConfig = {
  clientId: string;
  clientSecret: string;
  /** Identyfikator katalogu; Microsoft wymaga go w adresach logowania. */
  tenant?: string;
};

export type Tokens = {
  accessToken: string;
  refreshToken?: string;
  /** Znacznik wygaśnięcia w milisekundach. */
  expiresAt: number;
};

const SCOPES: Record<Provider, string> = {
  google: "https://www.googleapis.com/auth/calendar.events openid email",
  microsoft: "offline_access Calendars.ReadWrite User.Read",
};

function secretName(provider: Provider, what: string): string {
  return `${provider}/${what}`;
}

export async function readConfig(
  provider: Provider,
): Promise<ProviderConfig | undefined> {
  try {
    const clientId = await revealSecret(secretName(provider, "client_id"));
    const clientSecret = await revealSecret(
      secretName(provider, "client_secret"),
    );
    const tenant = await revealSecret(secretName(provider, "tenant")).catch(
      () => "common",
    );
    return { clientId, clientSecret, tenant };
  } catch {
    return undefined;
  }
}

export async function saveConfig(
  provider: Provider,
  config: ProviderConfig,
): Promise<void> {
  await saveSecret({
    name: secretName(provider, "client_id"),
    value: config.clientId,
    description: `Identyfikator aplikacji ${provider} dla kalendarza`,
  });
  await saveSecret({
    name: secretName(provider, "client_secret"),
    value: config.clientSecret,
    description: `Klucz tajny aplikacji ${provider}`,
  });
  if (config.tenant) {
    await saveSecret({
      name: secretName(provider, "tenant"),
      value: config.tenant,
      description: "Identyfikator katalogu Microsoft",
    });
  }
}

async function readTokens(provider: Provider): Promise<Tokens | undefined> {
  try {
    return JSON.parse(
      await revealSecret(secretName(provider, "tokens")),
    ) as Tokens;
  } catch {
    return undefined;
  }
}

async function writeTokens(provider: Provider, tokens: Tokens): Promise<void> {
  await saveSecret({
    name: secretName(provider, "tokens"),
    value: JSON.stringify(tokens),
    description: `Tokeny dostępu do kalendarza ${provider}`,
  });
}

export function redirectUri(provider: Provider, origin: string): string {
  return `${origin}/api/calendar/oauth/${provider}`;
}

function authBase(provider: Provider, tenant?: string): string {
  return provider === "google"
    ? "https://accounts.google.com/o/oauth2/v2/auth"
    : `https://login.microsoftonline.com/${tenant || "common"}/oauth2/v2.0/authorize`;
}

function tokenBase(provider: Provider, tenant?: string): string {
  return provider === "google"
    ? "https://oauth2.googleapis.com/token"
    : `https://login.microsoftonline.com/${tenant || "common"}/oauth2/v2.0/token`;
}

/** Adres, na który wysyłamy użytkownika, żeby wyraził zgodę. */
export async function authUrl(
  provider: Provider,
  origin: string,
): Promise<string> {
  const config = await readConfig(provider);
  if (!config) throw new Error(`Brak danych aplikacji ${provider} w sejfie`);

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri(provider, origin),
    response_type: "code",
    scope: SCOPES[provider],
    // Bez tego Google nie odda tokenu odświeżającego przy powtórnej zgodzie.
    ...(provider === "google"
      ? {
          access_type: "offline",
          prompt: "consent",
          include_granted_scopes: "true",
        }
      : { response_mode: "query" }),
  });
  return `${authBase(provider, config.tenant)}?${params}`;
}

/** Zamienia kod z przekierowania na tokeny i zapisuje je w sejfie. */
export async function exchangeCode(
  provider: Provider,
  code: string,
  origin: string,
): Promise<Tokens> {
  const config = await readConfig(provider);
  if (!config) throw new Error(`Brak danych aplikacji ${provider} w sejfie`);

  const res = await fetch(tokenBase(provider, config.tenant), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(provider, origin),
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(
      data.error_description ?? data.error ?? "Wymiana kodu nie powiodła się",
    );
  }

  const tokens: Tokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  await writeTokens(provider, tokens);
  return tokens;
}

/**
 * Ważny token dostępu. Odświeżamy z minutowym zapasem, żeby żądanie nie trafiło
 * w moment wygaśnięcia.
 */
export async function accessToken(
  provider: Provider,
): Promise<string | undefined> {
  const tokens = await readTokens(provider);
  if (!tokens) return undefined;
  if (tokens.expiresAt - 60_000 > Date.now()) return tokens.accessToken;
  if (!tokens.refreshToken) return undefined;

  const config = await readConfig(provider);
  if (!config) return undefined;

  try {
    const res = await fetch(tokenBase(provider, config.tenant), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: tokens.refreshToken,
        grant_type: "refresh_token",
        ...(provider === "microsoft" ? { scope: SCOPES.microsoft } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!res.ok || !data.access_token) return undefined;

    const fresh: Tokens = {
      accessToken: data.access_token,
      // Google zwykle nie odsyła tokenu odświeżającego przy odnowieniu.
      refreshToken: data.refresh_token ?? tokens.refreshToken,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
    await writeTokens(provider, fresh);
    return fresh.accessToken;
  } catch {
    return undefined;
  }
}

export async function connectionStatus(): Promise<
  Record<Provider, { configured: boolean; connected: boolean }>
> {
  const out = {} as Record<
    Provider,
    { configured: boolean; connected: boolean }
  >;
  for (const provider of ["google", "microsoft"] as Provider[]) {
    out[provider] = {
      configured: Boolean(await readConfig(provider)),
      connected: Boolean(await accessToken(provider)),
    };
  }
  return out;
}
