import { authUrl, exchangeCode, splitAccount } from "@/lib/calendar-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Prosta strona zamykająca kartę zgody; panel odpytuje stan sam. */
function done(message: string, ok: boolean): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Fluxdesk</title>
     <body style="font:15px system-ui;background:#0c0d10;color:#e6e6e6;display:grid;place-items:center;height:100vh;margin:0">
     <div style="text-align:center">
       <p style="font-size:20px;color:${ok ? "#4ade80" : "#f87171"}">${message}</p>
       <p style="color:#9ca3af">Możesz zamknąć tę kartę i wrócić do panelu.</p>
     </div>
     <script>setTimeout(() => window.close(), 2500)</script>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

/**
 * Jeden adres obsługuje oba kroki logowania: bez parametru `code` odsyła
 * na stronę zgody dostawcy, a z kodem zamienia go na tokeny.
 *
 * Kończymy własną stroną, a nie przekierowaniem do panelu: zgoda otwiera się
 * w zwykłej przeglądarce, a okno panelu ma zostać tam, gdzie było.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ provider: string }> },
) {
  const { provider } = await ctx.params;
  if (provider !== "google" && provider !== "microsoft") {
    return new Response("Nieznany dostawca", { status: 400 });
  }

  const url = new URL(req.url);
  const origin = url.origin;
  const code = url.searchParams.get("code");
  // Konto wraca w `state`, bo adres powrotny jest wspólny dla dostawcy.
  const account =
    url.searchParams.get("state") ||
    url.searchParams.get("account") ||
    provider;
  const error =
    url.searchParams.get("error_description") ?? url.searchParams.get("error");

  if (error) return done(`Zgoda nie została udzielona: ${error}`, false);

  try {
    if (!code) return Response.redirect(await authUrl(account, origin), 302);
    await exchangeCode(account, code, origin);
    const { label } = splitAccount(account);
    return done(`Kalendarz ${label} połączony`, true);
  } catch (e) {
    return done(e instanceof Error ? e.message : String(e), false);
  }
}
