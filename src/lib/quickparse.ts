/**
 * Zamienia zdanie w rodzaju „dentysta środa 16" na blok w kalendarzu.
 * Sam parser łapie zapisy, których używa się na co dzień; wszystko dziwniejsze
 * przejmuje model przez wywołanie narzędzia (patrz aiparse.ts).
 */

export type QuickBlock = {
  title: string;
  start: number;
  end: number;
};

const DAYS: Record<string, number> = {
  niedziela: 0,
  nd: 0,
  niedz: 0,
  poniedzialek: 1,
  poniedziałek: 1,
  pon: 1,
  pn: 1,
  wtorek: 2,
  wt: 2,
  sroda: 3,
  środa: 3,
  srode: 3,
  środę: 3,
  sr: 3,
  śr: 3,
  czwartek: 4,
  czw: 4,
  cz: 4,
  piatek: 5,
  piątek: 5,
  pt: 5,
  pi: 5,
  sobota: 6,
  sob: 6,
  sb: 6,
};

const MONTHS: Record<string, number> = {
  stycznia: 0,
  lutego: 1,
  marca: 2,
  kwietnia: 3,
  maja: 4,
  czerwca: 5,
  lipca: 6,
  sierpnia: 7,
  wrzesnia: 8,
  września: 8,
  pazdziernika: 9,
  października: 9,
  listopada: 10,
  grudnia: 11,
};

/** Litery z ogonkami zostawiamy, ale porównania robimy bez wielkości liter. */
function words(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(Boolean);
}

function startOfDay(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Najbliższy taki dzień tygodnia, licząc od jutra dla dnia dzisiejszego. */
function nextWeekday(from: number, weekday: number): number {
  const base = startOfDay(from);
  const today = new Date(base).getDay();
  let delta = (weekday - today + 7) % 7;
  if (delta === 0) delta = 7;
  return base + delta * 86_400_000;
}

type Found<T> = { value: T; used: number[] };

function findDay(list: string[], now: number): Found<number> | undefined {
  for (let i = 0; i < list.length; i++) {
    const w = list[i].replace(/[.,]$/, "");

    if (w === "dzis" || w === "dziś" || w === "dzisiaj")
      return { value: startOfDay(now), used: [i] };
    if (w === "jutro")
      return { value: startOfDay(now) + 86_400_000, used: [i] };
    if (w === "pojutrze")
      return { value: startOfDay(now) + 2 * 86_400_000, used: [i] };

    const weekday = DAYS[w];
    if (weekday !== undefined) {
      // „w środę", „we wtorek": przyimek zjadamy razem z dniem.
      const prev = list[i - 1] ?? "";
      const used = prev === "w" || prev === "we" ? [i - 1, i] : [i];
      // „przyszły czwartek" to ten po najbliższym, gdy najbliższy jest w tym
      // samym tygodniu kalendarzowym.
      const later = /^(przysz|nastep|następ)/.test(prev);
      const at = nextWeekday(now, weekday);
      const sameWeek =
        new Date(at).getTime() - startOfDay(now) < (7 - new Date(now).getDay()) * 86_400_000;
      return {
        value: later && sameWeek ? at + 7 * 86_400_000 : at,
        used: later ? [...used, i - 1] : used,
      };
    }

    // 12.09, 12/09, 12.09.2026
    const numeric = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/.exec(w);
    if (numeric) {
      const day = Number(numeric[1]);
      const month = Number(numeric[2]) - 1;
      // Bez tego „13.30" udaje datę w trzydziestym miesiącu.
      if (day < 1 || day > 31 || month < 0 || month > 11) continue;
      const year = numeric[3]
        ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3])
        : new Date(now).getFullYear();
      const at = new Date(year, month, day).getTime();
      if (!Number.isNaN(at)) {
        // Bez podanego roku data w przeszłości znaczy „w przyszłym roku".
        const shifted =
          !numeric[3] && at < startOfDay(now)
            ? new Date(year + 1, month, day).getTime()
            : at;
        return { value: shifted, used: [i] };
      }
    }

    // 12 września
    const dayNumber = /^(\d{1,2})$/.exec(w);
    const month = MONTHS[(list[i + 1] ?? "").replace(/[.,]$/, "")];
    if (dayNumber && month !== undefined) {
      const year = new Date(now).getFullYear();
      const at = new Date(year, month, Number(dayNumber[1])).getTime();
      const shifted =
        at < startOfDay(now)
          ? new Date(year + 1, month, Number(dayNumber[1])).getTime()
          : at;
      return { value: shifted, used: [i, i + 1] };
    }
  }
  return undefined;
}

function minutesOfDay(hour: number, minute: number): number {
  return hour * 60 + minute;
}

type Time = { from: number; to?: number };

/** Pory dnia: bez konkretnej godziny lepsze to niż domyślne 9:00. */
const PARTS_OF_DAY: Record<string, number> = {
  rano: 9 * 60,
  raniutko: 8 * 60,
  przedpoludniem: 10 * 60,
  przedpołudniem: 10 * 60,
  poludniem: 12 * 60,
  południem: 12 * 60,
  poludnie: 12 * 60,
  południe: 12 * 60,
  popoludniu: 14 * 60,
  popołudniu: 14 * 60,
  wieczorem: 18 * 60,
  wieczor: 18 * 60,
  wieczór: 18 * 60,
  noca: 21 * 60,
  nocą: 21 * 60,
};

function findTime(list: string[], skip: Set<number>): Found<Time> | undefined {
  for (let i = 0; i < list.length; i++) {
    if (skip.has(i)) continue;
    const w = list[i].replace(/[.,]$/, "");

    // Zakres: 16-17, 16:00-17:30, 9.30-11
    const range =
      /^(\d{1,2})(?:[:.](\d{2}))?\s*[-–]\s*(\d{1,2})(?:[:.](\d{2}))?$/.exec(w);
    if (range) {
      const from = minutesOfDay(Number(range[1]), Number(range[2] ?? 0));
      const to = minutesOfDay(Number(range[3]), Number(range[4] ?? 0));
      if (from < 24 * 60 && to <= 24 * 60) {
        const prev = list[i - 1];
        const used = prev === "o" || prev === "na" ? [i - 1, i] : [i];
        return { value: { from, to }, used };
      }
    }

    // Pojedyncza godzina: 16, 16:30, 16.30
    const single = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(w);
    if (single) {
      const hour = Number(single[1]);
      const minute = Number(single[2] ?? 0);
      // Samotne „16" to godzina, ale „45" w „na 45 min" już nie.
      const next = (list[i + 1] ?? "").replace(/[.,]$/, "");
      const isDuration = /^(min|minut|minuty|m|h|godz|godziny|godzin)$/.test(
        next,
      );
      if (isDuration) continue;
      if (hour > 23 || minute > 59) continue;
      if (!single[2] && hour === 0) continue;

      const prev = list[i - 1];
      const used = prev === "o" || prev === "na" ? [i - 1, i] : [i];
      return { value: { from: minutesOfDay(hour, minute) }, used };
    }
  }

  // „rano", „po południu", „przed południem": dwa słowa też liczymy jako jedno.
  for (let i = 0; i < list.length; i++) {
    if (skip.has(i)) continue;
    const one = list[i].replace(/[.,]$/, "");
    const two = `${one}${(list[i + 1] ?? "").replace(/[.,]$/, "")}`;
    if (PARTS_OF_DAY[two] !== undefined) {
      const prev = list[i - 1];
      const used =
        prev === "przed" || prev === "po"
          ? [i - 1, i, i + 1]
          : [i, i + 1];
      return { value: { from: PARTS_OF_DAY[two] }, used };
    }
    if (PARTS_OF_DAY[one] !== undefined) {
      const prev = list[i - 1];
      const used = prev === "przed" || prev === "po" ? [i - 1, i] : [i];
      return { value: { from: PARTS_OF_DAY[one] }, used };
    }
  }
  return undefined;
}

function findDuration(
  list: string[],
  skip: Set<number>,
): Found<number> | undefined {
  for (let i = 0; i < list.length; i++) {
    if (skip.has(i)) continue;
    const w = list[i].replace(/[.,]$/, "");

    // Sklejone: 2h, 90min, 1,5h
    const joined = /^(\d+(?:[.,]\d+)?)(h|godz|min|m)$/.exec(w);
    if (joined) {
      const amount = Number(joined[1].replace(",", "."));
      const minutes = /^h|godz/.test(joined[2]) ? amount * 60 : amount;
      const prev = list[i - 1];
      const used = prev === "na" || prev === "przez" ? [i - 1, i] : [i];
      return { value: Math.round(minutes), used };
    }

    // Rozdzielone: 45 min, 2 godziny, 1,5 h
    const number = /^(\d+(?:[.,]\d+)?)$/.exec(w);
    const unit = (list[i + 1] ?? "").replace(/[.,]$/, "");
    if (number && /^(h|m|min|minut|minuty|godz|godzin|godziny)$/.test(unit)) {
      const amount = Number(number[1].replace(",", "."));
      const minutes = /^(h|godz)/.test(unit) ? amount * 60 : amount;
      const prev = list[i - 1];
      const used =
        prev === "na" || prev === "przez" ? [i - 1, i, i + 1] : [i, i + 1];
      return { value: Math.round(minutes), used };
    }
  }
  return undefined;
}

/**
 * Zwraca blok albo `undefined`, gdy w tekście nie widać godziny ani dnia.
 * Domyślna długość to 60 minut, a bez podanego dnia bierzemy dziś, chyba że
 * godzina już minęła; wtedy jutro, bo tak zwykle myśli piszący.
 */
export function parseQuick(
  text: string,
  now = Date.now(),
  defaultMinutes = 60,
): QuickBlock | undefined {
  const list = words(text);
  if (list.length === 0) return undefined;

  const day = findDay(list, now);
  // Token zjedzony przez datę nie może jeszcze raz uchodzić za godzinę:
  // „12.09" to dzień, a nie 12:09.
  const taken = new Set<number>(day?.used ?? []);
  const duration = findDuration(list, taken);
  for (const i of duration?.used ?? []) taken.add(i);
  const time = findTime(list, taken);
  if (!time && !day) return undefined;

  const used = new Set<number>([
    ...(day?.used ?? []),
    ...(time?.used ?? []),
    ...(duration?.used ?? []),
  ]);

  // Słowa bez treści, które inaczej zostają w nazwie: „spotkanie gdzieś w…".
  const FILLER =
    /^(gdzies|gdzieś|okolo|około|kolo|koło|mniej|wiecej|więcej|jakos|jakoś|w|we|o|na|przez|do|az|aż|tak|jeszcze|jutrzejszy|przyszly|przyszły|przyszlym|przyszłym|przyszla|przyszła|przyszlym|nastepny|następny|nastepnym|następnym|ten|tym)$/;

  const title = list
    .map((w, i) =>
      used.has(i) || FILLER.test(w.replace(/[.,]$/, "")) ? undefined : w,
    )
    .filter((w): w is string => Boolean(w))
    .join(" ")
    .replace(/^[-–,\s]+|[-–,\s]+$/g, "")
    .trim();
  // Sam czas bez nazwy też ma sens: to po prostu zajęta godzina do opisania.
  const label = title || "Blok czasu";

  const base = day?.value ?? startOfDay(now);
  // Bez godziny blok zaczyna się o 9:00, czyli na początku dnia pracy.
  const fromMinutes = time?.value.from ?? 9 * 60;
  let start = base + fromMinutes * 60_000;
  if (!day && start < now) start += 86_400_000;

  const minutes =
    duration?.value ??
    (time?.value.to !== undefined
      ? time.value.to - time.value.from
      : defaultMinutes);
  if (minutes <= 0) return undefined;

  return {
    // Pierwsza litera duża, żeby lista nie wyglądała jak notatka na kolanie.
    title: label.charAt(0).toUpperCase() + label.slice(1),
    start,
    end: start + minutes * 60_000,
  };
}
