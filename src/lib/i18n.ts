"use client";

import { useEffect, useState } from "react";

/**
 * Dwa języki interfejsu. Słownik trzymamy po polskiej treści, a nie po
 * wymyślonych kluczach: dzięki temu każdy napis w kodzie nadal czyta się jak
 * zdanie, a brak tłumaczenia oznacza po prostu polski oryginał, nie puste pole.
 */

export type Lang = "pl" | "en";

const KEY = "fluxdesk-lang";

const EN: Record<string, string> = {
  /* nagłówek i sesje */
  Zadania: "Tasks",
  Kalendarz: "Calendar",
  Wznów: "Resume",
  "+ Nowa": "+ New",
  "+ Terminal": "+ Terminal",
  Siatka: "Grid",
  Konsola: "Console",
  Jedna: "Single",
  Dwie: "Split",
  Skróty: "Shortcuts",
  "Nowa sesja": "New session",
  "Wznów zapisaną sesję": "Resume saved session",
  "Nowy terminal (pełny claude)": "New terminal (full claude)",
  "Tablica zadań": "Task board",
  Pamięć: "Memory",
  Projekty: "Projects",
  Dziennik: "Journal",
  Sejf: "Vault",
  Szukaj: "Search",
  "Szukaj rozmowy…": "Search conversations…",
  Zamknij: "Close",
  Zapisz: "Save",
  Usuń: "Delete",
  Odrzuć: "Discard",
  Dodaj: "Add",
  Anuluj: "Cancel",

  /* stany sesji */
  gotowa: "ready",
  pracuje: "working",
  czeka: "waiting",
  bezczynna: "idle",
  zatrzymana: "stopped",
  "sesja czeka": "session waiting",
  "sesji czeka": "sessions waiting",

  /* kalendarz */
  dziś: "today",
  Źródła: "Sources",
  "Ukryj źródła": "Hide sources",
  Zaplanuj: "Schedule",
  "Liczę…": "Working…",
  "Zasłoń zajętość": "Mirror busy time",
  "Znajdź wolny termin": "Find a free slot",
  "Zapisz na wszystkich kontach": "Save to every account",
  "Dołącz do spotkania": "Join meeting",
  "Usuń blok": "Delete block",
  "Przesuń o 15 min": "Move by 15 min",
  "Wolne u wszystkich:": "Free on every calendar:",
  "PRZECIĄGNIJ ZADANIE NA GODZINĘ": "DRAG A TASK ONTO AN HOUR",
  "Brak otwartych zadań.": "No open tasks.",
  "Twoje konta, zapis w obie strony": "Your accounts, two-way sync",
  "połączone, zapis działa": "connected, writing works",
  "dane aplikacji są, brakuje zgody": "app credentials saved, consent missing",
  "brak danych aplikacji": "no app credentials",
  Połącz: "Connect",
  "Połącz ponownie": "Reconnect",
  Odłącz: "Disconnect",
  Skonfiguruj: "Set up",
  "Konsola Google": "Google console",
  "Portal Azure": "Azure portal",
  "Adres powrotny:": "Redirect address:",
  kopiuj: "copy",
  skopiowano: "copied",
  "jak zdobyć te dane": "how to get these values",
  "ukryj instrukcję": "hide instructions",
  "Zapisz w sejfie": "Save to vault",
  "nazwa konta, np. firmowe": "account name, e.g. work",
  "identyfikator klienta": "client id",
  "klucz tajny": "client secret",
  "Zapis do kalendarzy:": "Writing to calendars:",
  niepołączony: "not connected",
  połączony: "connected",
  "rozpoznane przez model": "understood by the model",
  "rozpoznane bez modelu": "understood without the model",
  "W tym czasie już coś jest:": "Something is already booked then:",
  "Wysłałem ostrzeżenie na telefon.": "I sent a warning to your phone.",
  "Nie rozumiem terminu. Podaj dzień i godzinę":
    "I do not understand that date. Give a day and an hour",
  "cały dzień": "all day",
  min: "min",
  "Wydarzenie z podłączonego kalendarza; zmienisz je tam, gdzie powstało.":
    "Event from a connected calendar; change it where it was created.",
};

/** Tłumaczy napis; bez wpisu w słowniku zostaje polski oryginał. */
export function translate(text: string, lang: Lang): string {
  if (lang === "pl") return text;
  return EN[text] ?? text;
}

/**
 * Wybrany język wraz z funkcją tłumaczącą. Zapisujemy go w przeglądarce, więc
 * panel wraca w tym samym języku po restarcie.
 */
export function useLang(): {
  lang: Lang;
  setLang: (next: Lang) => void;
  t: (text: string) => string;
} {
  const [lang, setLangState] = useState<Lang>("pl");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "en" || saved === "pl") setLangState(saved);
    } catch {
      /* prywatne okno albo zablokowane dane stron */
    }
    // Zmiana języka w jednym miejscu ma przełączyć cały panel naraz.
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<Lang>).detail;
      if (next === "en" || next === "pl") setLangState(next);
    };
    window.addEventListener("fluxdesk-lang", onChange);
    return () => window.removeEventListener("fluxdesk-lang", onChange);
  }, []);

  const setLang = (next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* wybór zostanie tylko na czas tej sesji */
    }
    window.dispatchEvent(new CustomEvent("fluxdesk-lang", { detail: next }));
  };

  return { lang, setLang, t: (text: string) => translate(text, lang) };
}
