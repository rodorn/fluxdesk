"use client";

/**
 * Ikona rozmowy. Inicjały z nazwy nic nie mówiły, więc dobieramy symbol po tym,
 * czego sesja dotyczy: kod, raport, zdjęcia, scraper, poczta, finanse. Kolor
 * nadal wynika z katalogu, żeby ta sama praca zawsze wyglądała tak samo.
 */

type Kind =
  | "code"
  | "chart"
  | "image"
  | "doc"
  | "bot"
  | "car"
  | "mail"
  | "money"
  | "system"
  | "social"
  | "search"
  | "terminal"
  | "chat";

const RULES: { kind: Kind; test: RegExp }[] = [
  { kind: "social", test: /some\b|social|facebook|instagram|linkedin|tiktok|post\b/i },
  { kind: "search", test: /search|szuka|wyszuk|indeks|seo\b/i },
  { kind: "bot", test: /scrap|vinted|otomoto|watcher|automat|crawler|\bbot\b/i },
  { kind: "chart", test: /raport|analit|\bstat|ga4|metry|dashboard|wykres|audyt|\bcps\b|\bkpi\b|priorytet/i },
  { kind: "image", test: /zdj[ei]|foto|photo|obraz|image|baic|banner|grafik|logo/i },
  { kind: "car", test: /carmore|\bauto|samoch|leasing|pojazd|\bvin\b|oferta|offer|wniosk|umow|erste/i },
  { kind: "mail", test: /\bmail|poczta|smtp|dmarc|\bspf\b|newsletter|skrzynk/i },
  { kind: "money", test: /zarabia|koszt|faktur|\bzus\b|podat|rycza|\bvat\b|\bpit\b|cena|bud[żz]et|invoice/i },
  { kind: "doc", test: /blog|artyku|tre[śs][ćc]|content|\bwpis|tekst|dokument|notat|brief/i },
  {
    kind: "system",
    test: /\bsystem\b|\barch\b|linux|instalator|klawiatur|hyprland|firefox|docker|serwer|\bvps\b/i,
  },
  { kind: "code", test: /backend|frontend|\bapi\b|refaktor|\bkod\b|repo\b|gitlab|\bgit\b|deploy|\bbug\b|\btest|fluxdesk|panel/i },
];

function pick(title: string, cwd: string): Kind {
  const hit = RULES.find((r) => r.test.test(`${title} ${cwd}`));
  if (hit) return hit.kind;

  // Świeża sesja nie ma jeszcze tematu: jej nazwa to zwykle nazwa katalogu.
  // Zamiast udawać rozmowę, pokazujemy znak zachęty, a ikona dopasuje się sama,
  // gdy tylko CLI nada rozmowie tytuł.
  const dir = cwd.split("/").filter(Boolean).pop() ?? "";
  if (!title.trim() || title === dir || /^(terminal|nowa sesja)$/i.test(title)) {
    return "terminal";
  }
  return "chat";
}

/** Ścieżki rysowane w siatce 24x24, jednolitą grubością. */
const PATHS: Record<Kind, React.ReactNode> = {
  code: (
    <>
      <path d="M9 8.5 5.5 12 9 15.5" />
      <path d="M15 8.5 18.5 12 15 15.5" />
    </>
  ),
  chart: (
    <>
      <path d="M5 18.5V13M9.7 18.5V8M14.3 18.5v-4M19 18.5V5.5" />
    </>
  ),
  image: (
    <>
      <rect x="4" y="5.5" width="16" height="13" rx="2" />
      <circle cx="9" cy="10" r="1.4" />
      <path d="m5 16 4-3.5 4 3 3-2.5 3 3" />
    </>
  ),
  doc: (
    <>
      <path d="M7 4.5h7l4 4v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1Z" />
      <path d="M14 4.5v4h4M9 13h6M9 16h4" />
    </>
  ),
  bot: (
    <>
      <rect x="4.5" y="8" width="15" height="10.5" rx="2.5" />
      <path d="M12 8V5M9 13v1.5M15 13v1.5" />
      <circle cx="12" cy="4" r="1.2" />
    </>
  ),
  car: (
    <>
      <path d="M4 15.5h16M5.5 15.5V13l2-4.5h9l2 4.5v2.5" />
      <circle cx="8" cy="16.5" r="1.6" />
      <circle cx="16" cy="16.5" r="1.6" />
    </>
  ),
  mail: (
    <>
      <rect x="4" y="6" width="16" height="12" rx="2" />
      <path d="m4.8 7.5 7.2 5.5 7.2-5.5" />
    </>
  ),
  money: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 7.5v9M14.5 9.8c-.6-.8-1.5-1.1-2.5-1.1-1.4 0-2.4.7-2.4 1.8 0 2.4 5 1.2 5 3.6 0 1.2-1.1 1.9-2.6 1.9-1.1 0-2.1-.4-2.6-1.2" />
    </>
  ),
  system: (
    <>
      <rect x="4.5" y="4.5" width="15" height="15" rx="2.5" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <path d="M9 2.5v2M15 2.5v2M9 19.5v2M15 19.5v2M2.5 9h2M2.5 15h2M19.5 9h2M19.5 15h2" />
    </>
  ),
  social: (
    <>
      <circle cx="17" cy="6.5" r="2.5" />
      <circle cx="7" cy="12" r="2.5" />
      <circle cx="17" cy="17.5" r="2.5" />
      <path d="m9.3 10.8 5.4-3.1M9.3 13.2l5.4 3.1" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m15.5 15.5 4 4" />
    </>
  ),
  terminal: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <path d="m7.5 10 2.5 2-2.5 2M12.5 14.5h4" />
    </>
  ),
  chat: (
    <>
      <path d="M20 12.5c0 3.6-3.6 6.5-8 6.5-1 0-2-.15-2.9-.43L4.5 20l1.2-3.2C4.6 15.6 4 14.1 4 12.5 4 8.9 7.6 6 12 6s8 2.9 8 6.5Z" />
    </>
  ),
};

/**
 * Kolor idzie za rodzajem pracy, nie za katalogiem: większość sesji startuje
 * w katalogu domowym, więc barwa z niego wyprowadzona byłaby wszędzie ta sama.
 */
const TINT: Record<Kind, string> = {
  code: "#6366f1",
  chart: "#10b981",
  image: "#f59e0b",
  doc: "#64748b",
  bot: "#8b5cf6",
  car: "#0ea5e9",
  mail: "#f43f5e",
  money: "#16a34a",
  system: "#71717a",
  social: "#d946ef",
  search: "#06b6d4",
  terminal: "#4b5563",
  chat: "#7c7f8a",
};

/** Nadpisania z ustawień: własny kolor albo ikona dla konkretnego katalogu. */
function override(cwd: string): { kind?: Kind; color?: string } {
  try {
    const raw = localStorage.getItem("fluxdesk:icons");
    if (!raw) return {};
    const map = JSON.parse(raw) as Record<string, { kind?: Kind; color?: string }>;
    return map[cwd] ?? {};
  } catch {
    return {};
  }
}

export function SessionIcon({
  title,
  cwd,
  size = 32,
  terminal,
}: {
  title: string;
  cwd: string;
  size?: number;
  /** Terminale dostają obwódkę, żeby odróżnić je od sesji panelu. */
  terminal?: boolean;
}) {
  const custom = typeof window === "undefined" ? {} : override(cwd);
  const kind = custom.kind ?? pick(title, cwd);
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        background: custom.color ?? TINT[kind],
        color: "#fff",
        boxShadow: terminal
          ? "inset 0 0 0 1.5px rgba(255,255,255,0.35)"
          : undefined,
      }}
      title={`${cwd}${terminal ? " (terminal)" : ""}`}
    >
      <svg
        width={size * 0.58}
        height={size * 0.58}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {PATHS[kind]}
      </svg>
    </span>
  );
}
