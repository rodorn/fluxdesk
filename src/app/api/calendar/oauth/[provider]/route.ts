import { authUrl, exchangeCode, type Provider } from '@/lib/calendar-oauth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function isProvider(value: string): value is Provider {
  return value === 'google' || value === 'microsoft'
}

/**
 * Jeden adres obsługuje oba kroki logowania: bez parametru `code` odsyła
 * na stronę zgody dostawcy, a z kodem zamienia go na tokeny i wraca do panelu.
 */
export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params
  if (!isProvider(provider)) {
    return new Response('Nieznany dostawca', { status: 400 })
  }

  const url = new URL(req.url)
  const origin = url.origin
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error_description') ?? url.searchParams.get('error')

  if (error) {
    return Response.redirect(`${origin}/?calendar=${encodeURIComponent(error)}`, 302)
  }

  try {
    if (!code) {
      return Response.redirect(await authUrl(provider, origin), 302)
    }
    await exchangeCode(provider, code, origin)
    return Response.redirect(`${origin}/?calendar=polaczono-${provider}`, 302)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return Response.redirect(`${origin}/?calendar=${encodeURIComponent(message)}`, 302)
  }
}
