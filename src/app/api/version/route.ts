import fs from "node:fs/promises";
import path from "node:path";

import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Identyfikator wydania. Panel działa jako okno aplikacji, bez paska adresu,
 * więc nie ma jak wymusić odświeżenia ręcznie. Klient porównuje ten napis
 * i przeładowuje się sam, gdy pojawi się nowa wersja.
 */
export async function GET(req: Request) {
  return handle(req, async () => {
    try {
      const id = await fs.readFile(
        path.join(process.cwd(), ".next", "BUILD_ID"),
        "utf8",
      );
      return { build: id.trim() };
    } catch {
      return { build: "dev" };
    }
  });
}
