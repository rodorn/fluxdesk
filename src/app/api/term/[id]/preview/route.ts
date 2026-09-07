import { handle } from "@/lib/api";
import { connectTerminal } from "@/lib/terminals";
import { readTermStatus, type TermStatus } from "@/lib/termstate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Cache = Map<string, { at: number; status: TermStatus }>;
const ref = globalThis as unknown as { __csmTermPreview?: Cache };
const cache: Cache = (ref.__csmTermPreview ??= new Map());

/** Stan zmienia się co sekundę, ale odpytywanie kosztuje, więc trzymamy go chwilę. */
const TTL_MS = 4000;

/**
 * Stan sesji odczytany z ekranu terminala: czy czeka, pracuje, czy jest gotowa,
 * co dokładnie robi i ile zużyła kontekstu. Gospodarz trzyma bufor u siebie,
 * więc podłączamy się na moment i zapamiętujemy wynik.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return handle(req, async () => {
    const { id } = await ctx.params;
    const cached = cache.get(id);
    if (cached && Date.now() - cached.at < TTL_MS) return cached.status;

    const status = await new Promise<TermStatus>((resolve) => {
      const timer = setTimeout(() => resolve({ state: "unknown" }), 1500);
      connectTerminal(id, (msg) => {
        if (msg.t !== "snapshot") return;
        clearTimeout(timer);
        resolve(readTermStatus(msg.d));
      })
        .then((conn) => setTimeout(() => conn.close(), 1600))
        .catch(() => {
          clearTimeout(timer);
          resolve({ state: "unknown" });
        });
    });

    cache.set(id, { at: Date.now(), status });
    return status;
  });
}
