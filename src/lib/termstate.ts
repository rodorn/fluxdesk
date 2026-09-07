/**
 * Odczyt stanu sesji z ekranu terminala. Claude Code nie wystawia go w żaden
 * inny sposób, więc czytamy to, co i tak widać: linię czynności, pasek statusu
 * i pytania o zgodę. Dzięki temu lista rozmów mówi, co się w nich dzieje.
 */

export type TermState = "waiting" | "working" | "idle" | "unknown";

export type TermStatus = {
  state: TermState;
  /** Ostatnia sensowna linia ekranu. */
  line?: string;
  /** Co robi w tej chwili, na przykład „Running 1 shell command”. */
  activity?: string;
  /** Czas bieżącej czynności w sekundach, jeśli terminal go pokazuje. */
  elapsedSec?: number;
  /** Zapełnienie okna kontekstu w procentach. */
  contextPct?: number;
  /** Koszt tury wyświetlany na pasku statusu. */
  costUsd?: number;
  /** Model zgłoszony przez pasek statusu. */
  model?: string;
  /** Liczba podagentów pracujących w tle. */
  agents?: number;
  /** Treść pytania, gdy sesja czeka na decyzję. */
  question?: string;
};

const ESC = String.fromCharCode(27);

/** Usuwa kody sterujące i ramki, zostawiając czytelne linie. */
export function screenLines(screen: string): string[] {
  const plain = screen
    .split(ESC)
    .map((part, i) => {
      if (i === 0) return part;
      // Skok kursora w kolumnę zastępuje spacje, więc oddajemy je z powrotem.
      const column = /^\[[0-9]+G/.exec(part);
      if (column) return " " + part.slice(column[0].length);
      return part
        .replace(/^\[[0-9;?]*[a-zA-Z]/, "")
        .replace(/^[()][A-Z0-9]/, "")
        .replace(/^[=>78]/, "");
    })
    .join("");

  return plain
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[─-╿▀-▟]/g, "").trim())
    .filter((l) => l.length > 1);
}

/** Czasy w rodzaju „3m 33s” albo „45s”. */
function parseElapsed(text: string): number | undefined {
  const m = /(?:(\d+)m\s*)?(\d+)s/.exec(text);
  if (!m) return undefined;
  return Number(m[1] ?? 0) * 60 + Number(m[2]);
}

export function readTermStatus(screen: string): TermStatus {
  const lines = screenLines(screen);
  const tail = lines.slice(-40);
  const status: TermStatus = {
    state: "unknown",
    line: lines.at(-1)?.slice(0, 120),
  };

  // Pasek statusu na dole: model, zapełnienie kontekstu, koszt.
  for (const line of tail.slice(-6)) {
    const ctx = /ctx\s+(\d+)%/i.exec(line);
    if (ctx) status.contextPct = Number(ctx[1]);
    // Kwota liczy się tylko w pasku statusu, obok modelu i zapełnienia kontekstu.
    if (/ctx\s+\d+%/i.test(line) || /^(Opus|Sonnet|Haiku)\s/i.test(line)) {
      const cost = /\$\s?(\d+[.,]\d{2})/.exec(line);
      if (cost) status.costUsd = Number(cost[1].replace(",", "."));
    }
    const model = /^(Opus|Sonnet|Haiku)\s+[\d.]+/i.exec(line);
    if (model) status.model = line.split("·")[0].trim();
  }

  // Podagenci: CLI pokazuje ich licznik przy pasku trybu.
  for (const line of tail) {
    const agents = /(\d+)\s+agent/i.exec(line);
    if (agents) status.agents = Number(agents[1]);
  }

  // Pytanie o zgodę przebija wszystko inne, bo blokuje sesję.
  const question = tail.find((l) =>
    /^(Do you want|Would you like|Czy chcesz)/i.test(l),
  );

  // Wznawianie długiej rozmowy zaczyna się od wyboru, który potrafi zablokować
  // sesję na godziny, jeśli nikt go nie zobaczy.
  if (tail.some((l) => /resume from summary|resume full session/i.test(l))) {
    const size = tail.find((l) => /this session is .* old and .* tokens/i.test(l));
    status.state = "waiting";
    status.question = size
      ? `Jak wznowić? ${size.replace(/^this session is\s*/i, "").slice(0, 80)}`
      : "Jak wznowić rozmowę: ze streszczenia czy w całości?";
    return status;
  }
  const hasChoices = tail.some(
    (l) => /^[❯>]\s*\d+\./.test(l) || /\b1\.\s*Yes\b/i.test(l),
  );
  if (question || hasChoices) {
    status.state = "waiting";
    status.question = question?.slice(0, 120);
    return status;
  }

  // Praca: spinner z gerundem, licznik czasu albo podpowiedź o przerwaniu.
  // Kluczowa jest kolejność: linia „· done” zamyka turę, więc spinner sprzed
  // niej to już historia, a nie stan bieżący.
  const bottom = tail.slice(-12);
  const lastDone = bottom.map((l) => /·\s*done\b|\bdone\s+\d{1,2}:\d{2}/i.test(l)).lastIndexOf(true);
  const after = lastDone === -1 ? bottom : bottom.slice(lastDone + 1);

  const working = [...after]
    .reverse()
    .find(
      (l) =>
        /\besc to interrupt\b/i.test(l) ||
        /press up to edit queued/i.test(l) ||
        // „Germinating… (33s · ↓ 1.2k tokens)” — wielokropek bywa w środku linii.
        /\w…/.test(l) ||
        /\(\s*\d+m?\s*\d*s\s*[·)]/.test(l),
    );

  if (working) {
    status.state = "working";
    const activity = /([A-Za-zŁŚŻŹĆąćęłńóśźż][\w -]*?)…/.exec(working);
    if (activity) status.activity = activity[1].trim().slice(0, 60);
    const elapsed = parseElapsed(working);
    if (elapsed) status.elapsedSec = elapsed;
    return status;
  }

  // Gotowa. Podgląd ma pokazywać ostatnią wypowiedź, a nie komunikat techniczny
  // w rodzaju sprawdzania aktualizacji, który zostaje na ekranie po starcie.
  status.state = "idle";

  const noise =
    /checking for updates|remote control not started|no completion record|to move it to this terminal|bypass permissions on|shift\+tab to cycle|enter to confirm|esc to cancel|run \/remote-control|ctrl\+[a-z] to|\btab to\b|for shortcuts/i;

  const said = [...tail]
    .reverse()
    .find((l) => /^[●•]/.test(l) && l.length > 12 && !noise.test(l));

  if (said) {
    status.line = said.replace(/^[●•]\s*/, "").slice(0, 120);
  } else if (status.line && noise.test(status.line)) {
    // Po wznowieniu na ekranie są same komunikaty techniczne, a nie rozmowa.
    status.line = undefined;
  }
  return status;
}
