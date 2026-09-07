import type { TokenUsage } from './types'

/**
 * Cennik (USD za 1 mln tokenów). Wartości orientacyjne — służą do szacowania
 * kosztu sesji, gdy transkrypt nie zawiera pola `costUSD`.
 * Zaktualizuj według https://claude.com/pricing jeśli potrzebujesz precyzji.
 */
type Price = {
  input: number
  output: number
  /** Zapis do cache pięciominutowego (1,25x wejście). */
  cacheWrite: number
  /**
   * Zapis do cache godzinnego (2x wejście). Claude Code używa właśnie tego,
   * co widać w polu `cache_creation.ephemeral_1h_input_tokens`.
   */
  cacheWrite1h: number
  cacheRead: number
}

const PRICES: { match: RegExp; price: Price }[] = [
  {
    match: /opus/i,
    price: { input: 15, output: 75, cacheWrite: 18.75, cacheWrite1h: 30, cacheRead: 1.5 },
  },
  {
    match: /sonnet/i,
    price: { input: 3, output: 15, cacheWrite: 3.75, cacheWrite1h: 6, cacheRead: 0.3 },
  },
  {
    match: /haiku/i,
    price: { input: 1, output: 5, cacheWrite: 1.25, cacheWrite1h: 2, cacheRead: 0.1 },
  },
]

const FALLBACK: Price = {
  input: 3,
  output: 15,
  cacheWrite: 3.75,
  cacheWrite1h: 6,
  cacheRead: 0.3,
}

export function priceFor(model: string | undefined): Price {
  if (!model) return FALLBACK
  return PRICES.find((p) => p.match.test(model))?.price ?? FALLBACK
}

/**
 * Szacunkowy koszt pojedynczej odpowiedzi wedle cennika API.
 * Przy abonamencie nie płacisz za tokeny — to miara zużycia, nie rachunek.
 */
export function estimateCost(model: string | undefined, usage: TokenUsage): number {
  const p = priceFor(model)
  return (
    (usage.input * p.input +
      usage.output * p.output +
      usage.cacheCreate * p.cacheWrite1h +
      usage.cacheRead * p.cacheRead) /
    1_000_000
  )
}
