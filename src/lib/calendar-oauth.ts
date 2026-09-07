import { deleteSecret, revealSecret, saveSecret } from "./secrets";

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

/**
 * Kont jednego dostawcy może być kilka: prywatne i firmowe. Każde ma własny
 * identyfikator, a domyślne zostaje pod starą nazwą, żeby wcześniejsze
 * połączenia nadal działały.
 */
export type AccountId = string;

export function accountKey(provider: Provider, account?: AccountId): string {
  return account && account !== provider ? `${provider}:${account}` : provider;
}

/** Rozkłada identyfikator konta z powrotem na dostawcę i etykietę. */
export function splitAccount(id: AccountId): {
  provider: Provider;
  label: string;
} {
  const [provider, ...rest] = id.split(":");
  return {
    provider: provider === "microsoft" ? "microsoft" : "google",
    label: rest.join(":") || (provider === "google" ? "Google" : "Outlook"),
  };
}

function secretName(account: AccountId, what: string): string {
  return `${account}/${what}`;
}

export async function readConfig(
  account: AccountId,
): Promise<ProviderConfig | undefined> {
  try {
    const clientId = await revealSecret(secretName(account, "client_id"));
    const clientSecret = await revealSecret(
      secretName(account, "client_secret"),
    );
    const tenant = await revealSecret(secretName(account, "tenant")).catch(
      () => "common",
    );
    return { clientId, clientSecret, tenant };
  } catch {
    return undefined;
  }
}

export async function saveConfig(
  account: AccountId,
  config: ProviderConfig,
): Promise<void> {
  await saveSecret({
    name: secretName(account, "client_id"),
    value: config.clientId,
    description: `Identyfikator aplikacji ${account} dla kalendarza`,
  });
  await saveSecret({
    name: secretName(account, "client_secret"),
    value: config.clientSecret,
    description: `Klucz tajny aplikacji ${account}`,
  });
  if (config.tenant) {
    await saveSecret({
      name: secretName(account, "tenant"),
      value: config.tenant,
      description: "Identyfikator katalogu Microsoft",
    });
  }
}

async function readTokens(account: AccountId): Promise<Tokens | undefined> {
  try {
    return JSON.parse(
      await revealSecret(secretName(account, "tokens")),
    ) as Tokens;
  } catch {
    return undefined;
  }
}

async function writeTokens(account: AccountId, tokens: Tokens): Promise<void> {
  await saveSecret({
    name: secretName(account, "tokens"),
    value: JSON.stringify(tokens),
    description: `Tokeny dostępu do kalendarza ${account}`,
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
  account: AccountId,
  origin: string,
): Promise<string> {
  const { provider } = splitAccount(account);
  const config = await readConfig(account);
  if (!config) throw new Error(`Brak danych aplikacji ${account} w sejfie`);

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri(provider, origin),
    response_type: "code",
    scope: SCOPES[provider],
    // Konto wraca do nas w state, bo adres powrotny jest wspólny dla dostawcy.
    state: account,
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
  account: AccountId,
  code: string,
  origin: string,
): Promise<Tokens> {
  const { provider } = splitAccount(account);
  const config = await readConfig(account);
  if (!config) throw new Error(`Brak danych aplikacji ${account} w sejfie`);

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
  await writeTokens(account, tokens);
  return tokens;
}

/**
 * Ważny token dostępu. Odświeżamy z minutowym zapasem, żeby żądanie nie trafiło
 * w moment wygaśnięcia.
 */
export async function accessToken(
  account: AccountId,
): Promise<string | undefined> {
  const { provider } = splitAccount(account);
  const tokens = await readTokens(account);
  if (!tokens) return undefined;
  if (tokens.expiresAt - 60_000 > Date.now()) return tokens.accessToken;
  if (!tokens.refreshToken) return undefined;

  const config = await readConfig(account);
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
    await writeTokens(account, fresh);
    return fresh.accessToken;
  } catch {
    return undefined;
  }
}

export type AccountStatus = {
  id: AccountId;
  provider: Provider;
  label: string;
  configured: boolean;
  connected: boolean;
};

/** Lista kont poznana po sekretach w sejfie; zawsze pokazujemy oba domyślne. */
export async function listAccounts(): Promise<AccountStatus[]> {
  const ids = new Set<AccountId>(["google", "microsoft"]);
  try {
    const { listSecrets } = await import("./secrets");
    for (const secret of await listSecrets()) {
      const match = /^((?:google|microsoft)(?::[^/]+)?)\/client_id$/.exec(
        secret.name,
      );
      if (match) ids.add(match[1]);
    }
  } catch {
    /* sejf niedostępny: zostają domyślne */
  }

  const out: AccountStatus[] = [];
  for (const id of ids) {
    const { provider, label } = splitAccount(id);
    out.push({
      id,
      provider,
      label,
      configured: Boolean(await readConfig(id)),
      connected: Boolean(await accessToken(id)),
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Zgodność wstecz: stary kształt odpowiedzi dla dwóch domyślnych kont. */
export async function connectionStatus(): Promise<
  Record<Provider, { configured: boolean; connected: boolean }>
> {
  const accounts = await listAccounts();
  const pick = (p: Provider) => accounts.find((a) => a.id === p);
  return {
    google: {
      configured: Boolean(pick("google")?.configured),
      connected: Boolean(pick("google")?.connected),
    },
    microsoft: {
      configured: Boolean(pick("microsoft")?.configured),
      connected: Boolean(pick("microsoft")?.connected),
    },
  };
}

/**
 * Usuwa dane aplikacji i tokeny jednego konta. Potrzebne, gdy konto trzeba
 * przepiąć na inne albo panelu używa ktoś inny.
 */
export async function disconnect(account: AccountId): Promise<void> {
  for (const what of ["tokens", "client_id", "client_secret", "tenant"]) {
    await deleteSecret(secretName(account, what)).catch(() => undefined);
  }
}
