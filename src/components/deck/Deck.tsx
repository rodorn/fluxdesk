'use client'

import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Console, PERMISSION_MODES } from '@/components/deck/Console'
import { GridView } from '@/components/deck/GridView'
import { Help } from '@/components/deck/Help'
import { MemoryPanel } from '@/components/deck/MemoryPanel'
import { SettingsPanel } from '@/components/deck/SettingsPanel'
import { NewSession } from '@/components/deck/NewSession'
import { Palette, type Command } from '@/components/deck/Palette'
import { Overlay } from '@/components/deck/Overlay'
import { JournalPanel } from '@/components/deck/JournalPanel'
import { SearchPanel } from '@/components/deck/SearchPanel'
import { GitlabPanel } from '@/components/deck/GitlabPanel'
import { AttentionPanel } from '@/components/deck/AttentionPanel'
import { CalendarPanel } from '@/components/deck/CalendarPanel'
import { ProjectsPanel } from '@/components/deck/ProjectsPanel'
import { PulsePanel } from '@/components/deck/PulsePanel'
import { TaskBoard } from '@/components/deck/TaskBoard'
import { TasksPanel } from '@/components/deck/TasksPanel'
import { ResumePicker } from '@/components/deck/SessionPickers'
import { SessionRail, type RailEntry } from '@/components/deck/SessionRail'
import { TerminalView } from '@/components/deck/TerminalView'
import { useLang } from '@/lib/i18n'
import { ExternalPanel } from '@/components/deck/ExternalPanel'
import { Button } from '@/components/ui'
import { fmtTokens, fmtUsd } from '@/lib/format'
import { useDeck } from '@/lib/useDeck'
import type { SessionSummary } from '@/lib/types'

type Modal =
  | { kind: 'none' }
  | {
      kind: 'new'
      cwd?: string
      resume?: string
      title?: string
      workspaceId?: string
      terminal?: boolean
    }
  | { kind: 'resume' }
  | { kind: 'memory' }
  | { kind: 'palette' }
  | { kind: 'switch' }
  | { kind: 'tasks' }
  | { kind: 'board' }
  | { kind: 'gitlab' }
  | { kind: 'pulse' }
  | { kind: 'attention' }
  | { kind: 'projects' }
  | { kind: 'calendar' }
  | { kind: 'journal' }
  | { kind: 'search' }
  | { kind: 'help' }
  | { kind: 'settings' }

/** Pasek zużycia limitu: im bliżej setki, tym ostrzejszy kolor. */
function LimitBar({ label, pct, reset }: { label: string; pct: number; reset?: string }) {
  const tone = pct > 85 ? 'var(--err)' : pct > 60 ? 'var(--warn)' : 'var(--ok)'
  return (
    <span className="flex items-center gap-1 text-[10px] muted">
      <span>{label}</span>
      <span
        className="inline-block h-1.5 w-12 overflow-hidden rounded-full"
        style={{ background: 'var(--panel-2)' }}
      >
        <span
          className="block h-full rounded-full"
          style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: tone }}
        />
      </span>
      <span className="tabular-nums" style={{ color: tone }}>
        {pct}%
      </span>
      {reset ? <span className="opacity-60">{reset}</span> : null}
    </span>
  )
}

/** Czy fokus siedzi w polu tekstowym — wtedy litery nie są skrótami. */
function inTextField(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable
}

export function Deck() {
  const params = useSearchParams()
  const deck = useDeck()
  const { sessions, terminals, external, previews, act, close, closeTerminal, backfill, eventsOf } =
    deck

  const [activeId, setActiveId] = useState<string>()
  const [grid, setGrid] = useState(false)
  const [railOpen, setRailOpen] = useState(false)
  const [focus, setFocus] = useState(false)
  /** Grupowanie listy po projekcie; przy dwudziestu sesjach to różnica. */
  const [grouped, setGrouped] = useState(false)
  /** Tryb obserwatora: panel pokazuje, ale nie pozwala nic wysłać. */
  const [readOnly, setReadOnly] = useState(false)
  /** Ostatnio zamknięta sesja: zamknięcie bywa pomyłką, a rozmowa zostaje. */
  const [lastClosed, setLastClosed] = useState<{ cwd: string; sessionId?: string; title: string }>()
  /** Czas odpowiedzi panelu; widać, czy muli panel, czy model. */
  const [latencyMs, setLatencyMs] = useState<number>()
  /** Druga sesja pokazywana obok pierwszej; ultrapanoramiczny ekran to uniesie. */
  const [splitId, setSplitId] = useState<string>()
  const [browser, setBrowser] = useState<{ running: boolean; tabs?: unknown[] }>()
  const [limits, setLimits] = useState<{
    sessionPct?: number
    weekPct?: number
    sessionReset?: string
    weekReset?: string
    forecast?: string
    available: boolean
  }>()
  const [today, setToday] = useState<{
    sessions: number
    tokens: number
    costUsd: number
    activeMs: number
  }>()
  const [repos, setRepos] = useState<{ id: string; name: string; path: string }[]>([])
  const [mcp, setMcp] = useState<{ id: string; name: string; transport: string }[]>([])
  const [modal, setModal] = useState<Modal>({ kind: 'none' })
  const [toast, setToast] = useState<string>()
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const active = sessions.find((s) => s.id === activeId)
  const activeTerm = terminals.find((t) => t.id === activeId)
  const waiting = useMemo(() => sessions.filter((s) => s.pending.length > 0), [sessions])

  // Znacznik ostatnio obejrzanej aktywności — stąd wiadomo, co jest nieprzeczytane.
  const seenRef = useRef(new Map<string, number>())
  if (activeId) seenRef.current.set(activeId, Date.now())

  /**
   * Terminal wypisuje coś bez przerwy, choćby animację czekania, więc sam ruch
   * na ekranie nie oznacza nowości. Za nowe uznajemy dopiero moment, w którym
   * sesja przestała pracować, a Ciebie przy niej nie było.
   */
  const finishedRef = useRef(new Map<string, number>())
  const prevStateRef = useRef(new Map<string, string>())

  /** Ostatnia wypowiedź w sesji, skrócona do jednej linii. */
  const previewOf = useCallback(
    (id: string): string | undefined => {
      const events = eventsOf(id)
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i]
        const d = e.data as Record<string, unknown>
        if (e.kind === 'assistant-text' && typeof d.text === 'string') return d.text
        if (e.kind === 'user-text' && typeof d.text === 'string') return `Ty: ${d.text}`
        if (e.kind === 'tool-use' && typeof d.name === 'string') return `⚙ ${d.name}`
      }
      return undefined
    },
    [eventsOf]
  )

  // Sesje panelu i terminale trafiają do jednej listy — numeracja 1..9 jest wspólna.
  const entries: RailEntry[] = useMemo(
    () => [
      ...sessions.map((s) => ({
        id: s.id,
        kind: 'sdk' as const,
        title: s.title,
        cwd: s.cwd,
        status: s.status,
        lastAt: s.lastEventAt,
        pending: s.pending.length,
        queued: s.queued.length,
        costUsd: s.totalCostUsd,
        preview: previewOf(s.id)?.replace(/\s+/g, ' ').slice(0, 80),
        elapsedSec:
          s.status === 'running' && s.lastEventAt
            ? Math.round((Date.now() - s.lastEventAt) / 1000)
            : undefined,
        meta: [
          s.cwd.split('/').filter(Boolean).slice(-1)[0],
          s.model?.replace(/^claude-/, '').replace(/-\d{8}$/, ''),
          s.contextTokens ? `${Math.round((s.contextTokens / 200_000) * 100)}% kontekstu` : '',
          s.totalCostUsd ? `${s.totalCostUsd.toFixed(2)} USD` : '',
        ]
          .filter(Boolean)
          .join(' · '),
        unread: s.id !== activeId && s.lastEventAt > (seenRef.current.get(s.id) ?? 0),
      })),
      ...terminals.map((t) => ({
        id: t.id,
        kind: 'term' as const,
        title: t.title,
        cwd: t.cwd,
        lastAt: t.lastMessageAt ?? t.lastOutputAt,
        pending: 0,
        queued: 0,
        status: t.alive ? (previews[t.id]?.state ?? 'unknown') : 'stopped',
        preview: t.alive
          ? (previews[t.id]?.activity
              ? `${previews[t.id]!.activity}…`
              : (previews[t.id]?.question ?? previews[t.id]?.line ?? t.lastLine ?? 'uruchamianie…'))
          : `zakończony (${t.exitCode})`,
        meta: [
          t.cwd.split('/').filter(Boolean).slice(-1)[0],
          previews[t.id]?.model,
          previews[t.id]?.contextPct !== undefined
            ? `ctx ${previews[t.id]!.contextPct}%`
            : undefined,
          previews[t.id]?.agents ? `${previews[t.id]!.agents} agentów` : undefined,
        ]
          .filter(Boolean)
          .join(' · '),
        agents: previews[t.id]?.agents,
        elapsedSec: previews[t.id]?.elapsedSec,
        costUsd: previews[t.id]?.costUsd,
        stuckSec: t.stuck?.stuck ? Math.round(t.stuck.sinceMs / 1000) : undefined,
        duplicateOf: t.duplicateOf
          ? (terminals.find((o) => o.id === t.duplicateOf)?.title ?? 'inne okno')
          : undefined,
        unread: t.id !== activeId && (finishedRef.current.get(t.id) ?? 0) > (seenRef.current.get(t.id) ?? 0),
      })),
    ].sort((a, b) => b.lastAt - a.lastAt),
    [sessions, terminals, previews, activeId, previewOf]
  )

  // Sesja z adresu (?resume=…&cwd=…) otwiera od razu okno startu.
  useEffect(() => {
    const resume = params.get('resume')
    const cwd = params.get('cwd')
    const workspaceId = params.get('workspace')
    if (resume || cwd || workspaceId) {
      setModal({
        kind: 'new',
        resume: resume ?? undefined,
        cwd: cwd ?? undefined,
        workspaceId: workspaceId ?? undefined,
      })
    }
  }, [params])

  // Kontrast wraca po odświeżeniu razem z resztą układu.
  useEffect(() => {
    try {
      if (localStorage.getItem('fluxdesk:contrast') === 'high') {
        document.documentElement.setAttribute('data-contrast', 'high')
      }
    } catch {
      /* tryb prywatny */
    }
  }, [])

  // Układ wraca po odświeżeniu: ostatnio oglądana sesja i tryb widoku.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('fluxdesk:layout') ?? '{}')
      if (typeof saved.activeId === 'string') setActiveId(saved.activeId)
      if (typeof saved.grid === 'boolean') setGrid(saved.grid)
      if (typeof saved.focus === 'boolean') setFocus(saved.focus)
      if (typeof saved.splitId === 'string') setSplitId(saved.splitId)
      if (typeof saved.grouped === 'boolean') setGrouped(saved.grouped)
    } catch {
      /* pierwsze uruchomienie albo wyczyszczone dane */
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(
        'fluxdesk:layout',
        JSON.stringify({ activeId, grid, focus, splitId, grouped })
      )
    } catch {
      /* tryb prywatny */
    }
  }, [activeId, grid, focus, splitId, grouped])

  // Pierwsza sesja wybiera się sama, żeby ekran nie stał pusty.
  useEffect(() => {
    if (!activeId && entries.length) setActiveId(entries[0].id)
    if (activeId && !entries.some((e) => e.id === activeId)) setActiveId(entries[0]?.id)
  }, [entries, activeId])

  useEffect(() => {
    if (activeId && sessions.some((s) => s.id === activeId)) backfill(activeId)
  }, [activeId, sessions, backfill])

  // Tytuł karty niesie liczbę sesji czekających na decyzję — widać ją z innej karty.
  useEffect(() => {
    document.title = waiting.length ? `(${waiting.length}) Fluxdesk` : 'Fluxdesk'
  }, [waiting.length])

  // Powiadomienie systemowe, gdy sesja zaczyna czekać na zgodę.
  const notifiedRef = useRef(new Set<string>())
  useEffect(() => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    if (focus) return
    for (const s of waiting) {
      const key = `${s.id}:${s.pending[0].id}`
      if (notifiedRef.current.has(key)) continue
      notifiedRef.current.add(key)
      new Notification(`${s.title} czeka na zgodę`, { body: s.pending[0].ruleKey, tag: s.id })
    }
  }, [waiting, focus])

  // Przeglądarka w tle: sesje mogą z niej korzystać bez zabierania Twojego ekranu.
  useEffect(() => {
    const check = () =>
      fetch('/api/browser')
        .then((r) => (r.ok ? r.json() : undefined))
        .then((d) => d && setBrowser(d))
      .catch(() => undefined)
    check()
    const t = setInterval(check, 30_000)
    return () => clearInterval(t)
  }, [])

  // Przejście „pracuje → gotowa” to jedyny moment, który wart jest oznaczenia
  // jako coś nowego do przeczytania.
  useEffect(() => {
    for (const t of terminals) {
      const now = previews[t.id]?.state
      if (!now) continue
      const before = prevStateRef.current.get(t.id)
      if (before === 'working' && now !== 'working') {
        finishedRef.current.set(t.id, Date.now())
      }
      prevStateRef.current.set(t.id, now)
    }
  }, [terminals, previews])

  // Panel działa jako okno aplikacji, bez paska adresu, więc sam pilnuje wersji:
  // po przebudowie przeładowuje się, zamiast pokazywać stary interfejs.
  useEffect(() => {
    let known: string | undefined
    const check = async () => {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' })
        if (!res.ok) return
        const { build } = (await res.json()) as { build: string }
        if (!known) {
          known = build
          return
        }
        if (build !== known) window.location.reload()
      } catch {
        /* panel chwilowo niedostępny */
      }
    }
    check()
    const t = setInterval(check, 20_000)
    return () => clearInterval(t)
  }, [])

  // Ile panel potrzebuje na odpowiedź; przy mule widać, czy to on, czy model.
  useEffect(() => {
    const measure = async () => {
      const started = performance.now()
      try {
        await fetch('/api/version', { cache: 'no-store' })
        setLatencyMs(Math.round(performance.now() - started))
      } catch {
        setLatencyMs(undefined)
      }
    }
    measure()
    const t = setInterval(measure, 30_000)
    return () => clearInterval(t)
  }, [])

  // Limity tokenów: ta sama liczba, którą pokazuje pasek systemowy.
  useEffect(() => {
    const load = () =>
      fetch('/api/limits')
        .then((r) => (r.ok ? r.json() : undefined))
        .then((d) => d && setLimits(d))
      .catch(() => undefined)
    load()
    const t = setInterval(load, 120_000)
    return () => clearInterval(t)
  }, [])

  // Podsumowanie dnia w kolumnie bocznej; odświeżane rzadko, bo zmienia się wolno.
  useEffect(() => {
    const load = () =>
      fetch('/api/journal')
        .then((r) => (r.ok ? r.json() : undefined))
        .then((d) => d && setToday(d.totals))
      .catch(() => undefined)
    load()
    const t = setInterval(load, 120_000)
    return () => clearInterval(t)
  }, [])

  // Repozytoria i serwery MCP trafiają do palety, żeby wszystko było w tym jednym oknie.
  useEffect(() => {
    Promise.all([
      fetch('/api/repos').then((r) => (r.ok ? r.json() : undefined)),
      fetch('/api/mcp').then((r) => (r.ok ? r.json() : undefined)),
    ])
      .then(([r, m]) => {
        if (r) setRepos(r.items)
        if (m) setMcp(m.items)
      })
      .catch(() => undefined)
  }, [])

  const { lang, setLang, t } = useLang()

  // Na szerokim ekranie kalendarz mieszka w prawej kolumnie, zamiast zasłaniać
  // rozmowę nakładką; na wąskim zostaje nakładka, bo nie ma go gdzie wstawić.
  const [dock, setDock] = useState<'none' | 'calendar'>('none')
  // Im dłuższy widoczny okres, tym szersza kolumna kalendarza.
  const [calendarDays, setCalendarDays] = useState(1)
  const wideRef = useRef(false)
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1536px)')
    const sync = () => {
      wideRef.current = query.matches
    }
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  const openCalendar = useCallback(() => {
    if (wideRef.current) {
      setDock((d) => (d === 'calendar' ? 'none' : 'calendar'))
      setModal({ kind: 'none' })
    } else {
      setModal({ kind: 'calendar' })
    }
  }, [])

  const flash = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(undefined), 2600)
  }, [])

  // Powrót z logowania do kalendarza. Panel działa w oknie bez paska adresu,
  // więc bez tego wynik zgody nie byłby nigdzie widoczny.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get('calendar')
    if (!result) return
    const ok = result.startsWith('polaczono-')
    flash(
      ok
        ? `Kalendarz ${result.endsWith('google') ? 'Google' : 'Microsoft'} połączony`
        : `Logowanie do kalendarza nie przeszło: ${result}`
    )
    if (ok) setModal({ kind: 'calendar' })
    window.history.replaceState({}, '', window.location.pathname)
  }, [flash])

  const run = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      try {
        return await act(id, body)
      } catch (e) {
        flash(e instanceof Error ? e.message : String(e))
      }
    },
    [act, flash]
  )

  const jumpToWaiting = useCallback(() => {
    const next = waiting.find((s) => s.id !== activeId) ?? waiting[0]
    if (next) {
      setActiveId(next.id)
      setGrid(false)
    } else flash('Żadna sesja nie czeka na zgodę')
  }, [waiting, activeId, flash])

  /** Każde przełączenie sesji to przeskok uwagi; panel je zlicza. */
  const noteSwitch = useCallback(() => {
    fetch('/api/attention', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'activity', kind: 'switch' }),
    }).catch(() => undefined)
  }, [])

  const step = useCallback(
    (delta: number) => {
      if (!entries.length) return
      const i = entries.findIndex((e) => e.id === activeId)
      const next = entries[(i + delta + entries.length) % entries.length]
      setActiveId(next.id)
      setGrid(false)
      noteSwitch()
    },
    [entries, activeId, noteSwitch]
  )

  const cycleMode = useCallback(() => {
    if (!active) return
    const i = PERMISSION_MODES.findIndex((m) => m.value === active.permissionMode)
    const next = PERMISSION_MODES[(i + 1) % PERMISSION_MODES.length]
    run(active.id, { action: 'permissionMode', mode: next.value })
    flash(`Tryb uprawnień: ${next.label}`)
  }, [active, run, flash])

  const closeActive = useCallback(async () => {
    if (activeTerm) {
      // Zamknięcie okna nie kasuje rozmowy, ale warto wiedzieć, co się w niej działo.
      const preview = previews[activeTerm.id]
      const summary = [
        preview?.state === 'working' ? 'sesja właśnie pracuje' : undefined,
        preview?.contextPct ? `kontekst ${preview.contextPct}%` : undefined,
        preview?.costUsd ? `${preview.costUsd.toFixed(2)} USD` : undefined,
      ]
        .filter(Boolean)
        .join(', ')

      if (
        preview?.state === 'working' &&
        !confirm(`Zamknąć „${activeTerm.title}”? ${summary}. Rozmowa zostaje, można ją wznowić.`)
      ) {
        return
      }
      setLastClosed({
        cwd: activeTerm.cwd,
        sessionId: activeTerm.sessionId,
        title: activeTerm.title,
      })
      await closeTerminal(activeTerm.id)
      flash('Terminal zamknięty. U przywraca rozmowę')
      return
    }
    if (!active) return
    await close(active.id)
    flash('Sesja zamknięta')
  }, [active, activeTerm, previews, close, closeTerminal, flash])

  /**
   * Przejęcie sesji z okna terminala: otwiera w panelu terminal wznawiający tę
   * samą rozmowę. Stary proces zostaje — zamykasz go świadomie, nie przy okazji.
   */
  const adopt = useCallback(
    async (p: { cwd?: string; sessionId?: string; title?: string }, focus = true) => {
      if (!p.cwd) return
      try {
        const res = await fetch('/api/term', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cwd: p.cwd,
            title: p.title,
            resume: p.sessionId,
            permissionMode: 'bypassPermissions',
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        if (focus) {
          await deck.reload()
          setActiveId(data.id)
          setGrid(false)
        }
      } catch (e) {
        flash(e instanceof Error ? e.message : String(e))
      }
    },
    [deck, flash]
  )

  /** Nowy terminal w katalogu aktywnej sesji (albo w katalogu domowym). */
  const newTerminal = useCallback(
    async (cwd?: string) => {
      const target = cwd || active?.cwd || activeTerm?.cwd
      if (!target) {
        setModal({ kind: 'new', terminal: true })
        return
      }
      try {
        const res = await fetch('/api/term', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cwd: target, permissionMode: 'bypassPermissions' }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        await deck.reload()
        setActiveId(data.id)
        setGrid(false)
      } catch (e) {
        flash(e instanceof Error ? e.message : String(e))
      }
    },
    [active, activeTerm, deck, flash]
  )

  /* --- skróty klawiszowe --- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modal.kind !== 'none') return

      // Dwie warstwy skrótów: gołe klawisze, gdy nie piszesz (najszybsze),
      // oraz Ctrl+Alt, które działa zawsze i nie koliduje ani z przeglądarką,
      // ani z typowymi skrótami kompozytora.
      const chord = e.ctrlKey && e.altKey
      if ((e.ctrlKey || e.metaKey) && !chord) return

      // Czytamy `code`, nie `key` — z wciśniętym Altem znak bywa inny, a układ
      // klawiatury nie powinien decydować o działaniu skrótu.
      const code = e.code
      const typing = inTextField()

      // Esc przerywa turę, o ile nie masz nic wpisanego w polu.
      if (code === 'Escape' && active) {
        const el = document.activeElement as HTMLTextAreaElement | null
        if (el?.tagName === 'TEXTAREA' && el.value.trim()) return
        e.preventDefault()
        run(active.id, { action: 'interrupt' })
        flash('Przerwano')
        return
      }

      // Podczas pisania działa tylko warstwa z Ctrl+Alt, żeby nie zjadać liter.
      if (typing && !chord) return

      const digit = /^Digit([1-9])$/.exec(code)
      if (digit) {
        const index = Number(digit[1]) - 1
        if (entries[index]) {
          e.preventDefault()
          setActiveId(entries[index].id)
          setGrid(false)
        }
        return
      }

      // Gdy sesja czeka na zgodę, litery rozstrzygają właśnie ją.
      if ((!typing || chord) && active?.pending.length) {
        const decision =
          code === 'KeyY'
            ? 'allow'
            : code === 'KeyA'
              ? 'allow-always'
              : code === 'KeyN'
                ? 'deny'
                : undefined
        if (decision) {
          e.preventDefault()
          run(active.id, { action: 'permission', permissionId: active.pending[0].id, decision })
          return
        }
      }

      // Przypisania da się nadpisać w localStorage pod kluczem fluxdesk:keys,
      // bo układ klawiatury i przyzwyczajenia bywają różne.
      let overrides: Record<string, string> = {}
      try {
        overrides = JSON.parse(localStorage.getItem('fluxdesk:keys') ?? '{}')
      } catch {
        overrides = {}
      }

      const actions: Record<string, () => void> = {
        KeyJ: () => step(1),
        KeyK: () => step(-1),
        KeyA: jumpToWaiting,
        KeyN: () => setModal({ kind: 'new', cwd: active?.cwd }),
        KeyR: () => setModal({ kind: 'resume' }),
        KeyW: closeActive,
        KeyG: () => setGrid((v) => !v),
        KeyP: () => setModal({ kind: 'palette' }),
        KeyS: () => setModal({ kind: 'switch' }),
        KeyZ: () => setModal({ kind: 'tasks' }),
        KeyB: () => setModal({ kind: 'board' }),
        KeyL: () => setModal({ kind: 'gitlab' }),
        KeyY: () => setModal({ kind: 'pulse' }),
        KeyC: () => setModal({ kind: 'attention' }),
        KeyE: () => setModal({ kind: 'projects' }),
        KeyQ: () => openCalendar(),
        Comma: () => setModal({ kind: 'settings' }),
        KeyV: () => {
          // Pełny ekran jednej rozmowy: chowa listę, zakładki i kolumnę boczną.
          setFocus(true)
          setGrid(false)
          setSplitId(undefined)
        },
        KeyX: () => {
          // Przywrócenie ostatnio zamkniętej rozmowy pod tym samym identyfikatorem.
          if (!lastClosed) {
            flash('Nie ma czego przywracać')
            return
          }
          adopt(lastClosed)
          setLastClosed(undefined)
        },
        KeyD: () => setModal({ kind: 'journal' }),
        Slash: () => setModal({ kind: 'search' }),
        KeyF: () => {
          setFocus((v) => !v)
          flash(focus ? 'Tryb skupienia wyłączony' : 'Tryb skupienia: reszta wyciszona')
        },
        KeyM: () => setModal({ kind: 'memory' }),
        KeyH: () => setModal({ kind: 'help' }),
        KeyU: cycleMode,
        KeyT: () => newTerminal(),
        KeyI: () => inputRef.current?.focus(),
        KeyO: () => {
          // Podział bierze poprzednią sesję z listy, bo zwykle to ta, z której
          // przed chwilą przyszedłeś.
          if (splitId) {
            setSplitId(undefined)
            flash('Podział wyłączony')
            return
          }
          const other = entries.find((e) => e.id !== activeId)
          if (!other) {
            flash('Potrzebne są dwie sesje')
            return
          }
          setSplitId(other.id)
          setGrid(false)
        },
      }

      const mapped = overrides[code] ?? code
      const fn = actions[mapped]
      if (fn) {
        e.preventDefault()
        fn()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    modal.kind,
    entries,
    sessions,
    active,
    step,
    jumpToWaiting,
    closeActive,
    cycleMode,
    newTerminal,
    focus,
    splitId,
    lastClosed,
    adopt,
    run,
    flash,
  ])

  /** Skok po nazwie — wpisujesz kawałek tytułu i lądujesz w sesji. */
  const sessionCommands: Command[] = useMemo(
    () =>
      entries.map((e, i) => ({
        id: `switch:${e.id}`,
        label: e.title,
        hint: `${e.kind === 'term' ? 'terminal · ' : ''}${e.cwd}${
          e.pending ? ' · czeka na zgodę' : ''
        }`,
        keys: i < 9 ? String(i + 1) : undefined,
        run: () => {
          setActiveId(e.id)
          setGrid(false)
        },
      })),
    [entries]
  )

  const commands: Command[] = useMemo(() => {
    const base: Command[] = [
      { id: 'new', label: 'Nowa sesja', keys: 'Alt+N', run: () => setModal({ kind: 'new', cwd: active?.cwd }) },
      { id: 'resume', label: 'Wznów zapisaną sesję', keys: 'Alt+R', run: () => setModal({ kind: 'resume' }) },
      { id: 'term', label: 'Nowy terminal (pełny claude)', keys: 'Alt+T', run: () => newTerminal() },
      { id: 'calendar', label: 'Kalendarz (Google i Outlook)', keys: 'Q', run: () => openCalendar() },
      { id: 'settings', label: 'Ustawienia', keys: 'Alt+,', run: () => setModal({ kind: 'settings' }) },
      { id: 'grid', label: 'Przełącz siatkę sesji', keys: 'Alt+G', run: () => setGrid((v) => !v) },
      { id: 'memory', label: 'Pamięć', keys: 'Alt+M', run: () => setModal({ kind: 'memory' }) },
      { id: 'help', label: 'Skróty klawiszowe', keys: '?', run: () => setModal({ kind: 'help' }) },
      {
        id: 'browser',
        label: browser?.running
          ? `Przeglądarka w tle: działa (${browser.tabs?.length ?? 0} kart)`
          : 'Uruchom przeglądarkę w tle (Chrome na Xvfb)',
        hint: 'sesje sterują nią przez CDP, nie ruszając Twojego okna',
        run: async () => {
          flash('Uruchamiam przeglądarkę…')
          const res = await fetch('/api/browser', { method: 'POST' })
          const d = await res.json()
          setBrowser(d)
          flash(d.running ? 'Przeglądarka w tle gotowa' : (d.error ?? 'Nie udało się uruchomić'))
        },
      },
      {
        id: 'observer',
        label: readOnly ? 'Wyjdź z trybu obserwatora' : 'Tryb obserwatora',
        hint: 'panel tylko pokazuje, nic nie wysyła',
        run: () => setReadOnly((v) => !v),
      },
      {
        id: 'browser-hint',
        label: 'Wyślij sesji dostęp do przeglądarki w tle',
        hint: 'adres CDP i ekran, bez ruszania Twoich okien',
        run: async () => {
          if (!active) return flash('Najpierw wybierz sesję')
          const res = await fetch('/api/browser', { method: 'PUT' })
          const data = await res.json()
          if (!res.ok) return flash(data.error ?? 'Przeglądarka nie działa')
          run(active.id, { action: 'send', text: data.prompt })
          flash('Sesja wie już o przeglądarce')
        },
      },
      {
        id: 'contrast',
        label: 'Przełącz wysoki kontrast',
        hint: 'mocniejsze krawędzie i jaśniejszy tekst',
        run: () => {
          const root = document.documentElement
          const high = root.getAttribute('data-contrast') === 'high'
          if (high) root.removeAttribute('data-contrast')
          else root.setAttribute('data-contrast', 'high')
          try {
            localStorage.setItem('fluxdesk:contrast', high ? 'normal' : 'high')
          } catch {
            /* tryb prywatny */
          }
        },
      },
      {
        id: 'notify',
        label: 'Włącz powiadomienia systemowe',
        hint: 'sygnał, gdy sesja czeka na zgodę',
        run: () => Notification?.requestPermission?.(),
      },
    ]
    if (active) {
      base.push(
        { id: 'interrupt', label: `Przerwij: ${active.title}`, keys: 'Esc', run: () => run(active.id, { action: 'interrupt' }) },
        { id: 'mode', label: 'Zmień tryb uprawnień', keys: 'Alt+U', run: cycleMode },
        { id: 'close', label: `Zamknij: ${active.title}`, keys: 'Alt+W', run: closeActive }
      )
    }
    return [
      ...base,
      ...repos.map((r) => ({
        id: `repo:${r.id}`,
        label: `Nowa sesja w: ${r.name}`,
        hint: r.path,
        run: () => setModal({ kind: 'new', cwd: r.path }),
      })),
      ...repos.map((r) => ({
        id: `repoterm:${r.id}`,
        label: `Terminal w: ${r.name}`,
        hint: r.path,
        run: () => newTerminal(r.path),
      })),
      ...mcp.map((m) => ({
        id: `mcp:${m.id}`,
        label: `MCP: ${m.name} (${m.transport})`,
        hint: 'zarządzanie w Przestrzeniach',
        run: () => window.open('/workspaces', '_blank'),
      })),
      ...sessions.map((s, i) => ({
        id: `go:${s.id}`,
        label: `Idź do: ${s.title}`,
        hint: s.cwd,
        keys: i < 9 ? `Alt+${i + 1}` : undefined,
        run: () => {
          setActiveId(s.id)
          setGrid(false)
        },
      })),
    ]
  }, [
    active,
    sessions,
    repos,
    mcp,
    focus,
    run,
    cycleMode,
    closeActive,
    newTerminal,
    browser,
    flash,
  ])

  /** Jedna sesja: konsola panelu albo terminal, zależnie od tego, czym jest. */
  function renderSession(id?: string) {
    if (!id) return null
    const term = terminals.find((t) => t.id === id)
    if (term) {
      return (
        <TerminalView
          key={term.id}
          info={term}
          onClose={() => (id === splitId ? setSplitId(undefined) : closeActive())}
          onError={flash}
        />
      )
    }
    const session = sessions.find((s) => s.id === id)
    if (!session) return null
    return (
      <Console
        key={session.id}
        info={session}
        events={eventsOf(session.id)}
        inputRef={id === activeId ? inputRef : { current: null }}
        onAct={(body) => act(session.id, body)}
        onClose={() => (id === splitId ? setSplitId(undefined) : closeActive())}
        onError={flash}
      />
    )
  }

  return (
    <div className="flex h-[calc(100vh-1px)] min-h-0 flex-col gap-2 p-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <button
            onClick={() => setRailOpen((v) => !v)}
            className="rounded-lg px-2 py-1 text-sm lg:hidden"
            style={{ background: 'var(--panel-2)', border: '1px solid var(--border)' }}
            title="Lista sesji"
          >
            ☰
          </button>
          <h1 className="text-sm font-semibold">Fluxdesk</h1>
          <span className="text-[11px] muted">
            {sessions.length} sesji
            {terminals.length ? ` · ${terminals.length} term` : ''}
            {external.length ? ` · ${external.length} poza panelem` : ''}
            {readOnly ? (
              <span style={{ color: 'var(--warn)' }}> · obserwator, wysyłka wyłączona</span>
            ) : null}
            {latencyMs !== undefined && latencyMs > 300 ? (
              <span style={{ color: 'var(--warn)' }}> · panel {latencyMs} ms</span>
            ) : null}
            {repos.length ? ` · ${repos.length} repo` : ''}
            {mcp.length ? ` · ${mcp.length} mcp` : ''}
            {waiting.length ? ` · ${waiting.length} czeka na zgodę` : ''}
            {deck.connected ? '' : ' · brak połączenia'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {limits?.available ? (
            <div
              className="flex items-center gap-2 rounded-lg px-2.5 py-1"
              style={{ background: 'var(--panel)', border: '1px solid var(--border)' }}
              title={`Okno 5h: ${limits.sessionPct}% (reset za ${limits.sessionReset ?? '?'})\nTydzień: ${limits.weekPct}% (reset za ${limits.weekReset ?? '?'})${
                limits.forecast ? `\n${limits.forecast}` : ''
              }`}
            >
              <LimitBar label="5h" pct={limits.sessionPct ?? 0} reset={limits.sessionReset} />
              <LimitBar label="tydz." pct={limits.weekPct ?? 0} reset={limits.weekReset} />
              {limits.forecast && !/zapasem|znikome/.test(limits.forecast) ? (
                <span className="text-[10px]" style={{ color: 'var(--warn)' }}>
                  {limits.forecast}
                </span>
              ) : null}
            </div>
          ) : null}
          <Button onClick={() => setGrid((v) => !v)}>{grid ? t('Konsola') : t('Siatka')}</Button>
          <Button
            onClick={() => {
              if (splitId) return setSplitId(undefined)
              const other = entries.find((e) => e.id !== activeId)
              if (other) setSplitId(other.id)
            }}
            title="Dwie sesje obok siebie (O)"
          >
            {splitId ? t('Jedna') : t('Dwie')}
          </Button>
          <Button onClick={() => newTerminal()} title="Prawdziwy terminal (Alt+T)">
            {t('+ Terminal')}
          </Button>
          <Button onClick={() => setModal({ kind: 'board' })} title="Tablica zadań (B)">
            {t('Zadania')}
          </Button>
          <Button onClick={openCalendar} title={`${t('Kalendarz')} (Q)`}>
            {t('Kalendarz')}
          </Button>
          <Button onClick={() => setModal({ kind: 'resume' })}>{t('Wznów')}</Button>
          <Button variant="primary" onClick={() => setModal({ kind: 'new', cwd: active?.cwd })}>
            {t('+ Nowa')}
          </Button>
          <Button
            onClick={() => setModal({ kind: 'settings' })}
            title={t('Ustawienia') + ' (Alt+,)'}
          >
            ⚙
          </Button>
          <Button onClick={() => setModal({ kind: 'help' })} title={t('Skróty')}>
            ?
          </Button>
        </div>
      </header>

      {entries.filter((e) => e.status === 'working').length > 4 ? (
        <div
          className="rounded-lg px-3 py-1.5 text-xs"
          style={{ background: 'var(--panel)', border: '1px solid var(--warn)', color: 'var(--warn)' }}
        >
          {entries.filter((e) => e.status === 'working').length} sesji pracuje naraz. Powyżej
          czterech i tak nie da się tego pilnowac; F wycisza resztę.
        </div>
      ) : null}

      {waiting.length ? (
        <button
          onClick={jumpToWaiting}
          className="rounded-lg px-3 py-1.5 text-left text-xs"
          style={{ background: 'var(--panel)', border: '1px solid var(--warn)', color: 'var(--warn)' }}
        >
          {waiting.length} {waiting.length === 1 ? 'sesja czeka' : 'sesji czeka'} na zgodę — Alt+A
          przeskakuje do pierwszej ({waiting.map((s) => s.title.slice(0, 24)).join(', ')})
        </button>
      ) : null}

      <div
        className={`grid min-h-0 flex-1 gap-3 ${
          focus
            ? ''
            : dock === 'calendar'
              ? calendarDays >= 7
                ? 'lg:grid-cols-[15rem_1fr] 2xl:grid-cols-[17rem_minmax(0,1fr)_minmax(0,2.4fr)]'
                : calendarDays > 1
                  ? 'lg:grid-cols-[15rem_1fr] 2xl:grid-cols-[17rem_minmax(0,1fr)_minmax(0,1.2fr)]'
                  : 'lg:grid-cols-[15rem_1fr] 2xl:grid-cols-[17rem_1fr_34rem]'
              : 'lg:grid-cols-[15rem_1fr] 2xl:grid-cols-[17rem_1fr_21rem]'
        }`}
      >
        <aside
          className={`flex min-h-0 flex-col gap-2 ${
            focus ? 'hidden' : railOpen ? 'flex' : 'hidden lg:flex'
          }`}
        >
          {entries.length ? (
            <SessionRail
              entries={entries}
              activeId={activeId}
              onSelect={(id) => {
                setActiveId(id)
                setGrid(false)
                setRailOpen(false)
              }}
            />
          ) : (
            <p className="text-xs muted">Brak sesji. Alt+N zaczyna nową, Alt+T otwiera terminal.</p>
          )}
          <div className="shrink-0">
          <ExternalPanel
            items={external}
            onKill={(pid) => deck.killExternal(pid)}
            onResume={(p) => adopt(p)}
            onAdoptAll={async (list) => {
              for (const p of list) await adopt(p, false)
              await deck.reload()
              flash(`Przejęto ${list.length} rozmów`)
            }}
          />
          </div>
        </aside>

        <main
          className={`flex min-h-0 flex-col gap-2 overflow-hidden ${railOpen ? 'hidden lg:block' : ''}`}
        >
          {entries.length && !focus ? (
            <div className="flex gap-1 overflow-x-auto pb-1 lg:hidden">
              {entries.map((e, i) => (
                <button
                  key={e.id}
                  onClick={() => {
                    setActiveId(e.id)
                    setGrid(false)
                  }}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[11px]"
                  style={{
                    background: e.id === activeId ? 'var(--accent-soft)' : 'var(--panel)',
                    border: `1px solid ${
                      e.pending ? 'var(--warn)' : e.id === activeId ? 'var(--accent)' : 'var(--border)'
                    }`,
                    color: e.id === activeId ? 'var(--accent)' : 'var(--text)',
                  }}
                  title={`${e.cwd} — Alt+${i + 1}`}
                >
                  {i < 9 ? <span className="mono opacity-60">{i + 1}</span> : null}
                  <span className="max-w-[10rem] truncate">{e.title}</span>
                  {e.kind === 'term' ? <span className="mono opacity-50">tty</span> : null}
                  {e.pending ? (
                    <span
                      className="rounded px-1 font-semibold"
                      style={{ background: 'var(--warn)', color: '#000' }}
                    >
                      {e.pending}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-hidden">
          {splitId && !grid ? (
            <div className="grid h-full min-h-0 grid-cols-2 gap-3">
              <div className="min-h-0 overflow-hidden">{renderSession(activeId)}</div>
              <div
                className="min-h-0 overflow-hidden rounded-lg"
                style={{ outline: '1px solid var(--border)' }}
              >
                {renderSession(splitId)}
              </div>
            </div>
          ) : grid ? (
            <div className="h-full overflow-y-auto pr-1">
              <GridView
                sessions={sessions}
                eventsOf={eventsOf}
                onOpen={(id) => {
                  setActiveId(id)
                  setGrid(false)
                }}
                onAct={(id, body) => run(id, body)}
              />
            </div>
          ) : activeTerm ? (
            <TerminalView
              key={activeTerm.id}
              info={activeTerm}
              onClose={closeActive}
              onError={flash}
            />
          ) : active ? (
            <Console
              key={active.id}
              info={active}
              events={eventsOf(active.id)}
              inputRef={inputRef}
              onAct={(body) => act(active.id, body)}
              onClose={closeActive}
              onError={flash}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm muted">
                Nie ma otwartych sesji. To miejsce zastępuje pootwierane okna terminala.
              </p>
              <Button variant="primary" onClick={() => setModal({ kind: 'new' })}>
                Nowa sesja (Alt+N)
              </Button>
            </div>
          )}
          </div>
        </main>

        {focus ? null : (
          <aside className="hidden min-h-0 flex-col gap-3 overflow-y-auto 2xl:flex">
            {dock === 'calendar' ? (
              <section className="panel px-3 py-2.5">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-[11px] font-semibold muted">
                    {t('Kalendarz').toUpperCase()}
                  </h2>
                  <button
                    onClick={() => setDock('none')}
                    className="text-[10px] underline muted"
                  >
                    {t('Zamknij')}
                  </button>
                </div>
                <CalendarPanel onRangeChange={setCalendarDays} />
              </section>
            ) : null}

            <section className="panel px-3 py-2.5">
              <h2 className="mb-2 text-[11px] font-semibold muted">ZADANIA</h2>
              <TasksPanel
                sessionId={active?.sessionId}
                onUseAsPrompt={
                  active
                    ? (text) => {
                        run(active.id, { action: 'send', text })
                        flash('Wysłano zadanie do sesji')
                      }
                    : undefined
                }
              />
            </section>

            {today ? (
              <section className="panel px-3 py-2.5">
                <button
                  onClick={() => setModal({ kind: 'journal' })}
                  className="mb-2 flex w-full items-center justify-between text-[11px] font-semibold muted"
                >
                  DZIŚ <span className="opacity-60">rozwiń</span>
                </button>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'sesje', value: String(today.sessions) },
                    {
                      label: 'czas w panelu',
                      value: today.activeMs
                        ? `${Math.round(today.activeMs / 60000)} min`
                        : '—',
                    },
                    { label: 'tokeny', value: fmtTokens(today.tokens) },
                    { label: 'wg cennika', value: fmtUsd(today.costUsd) },
                  ].map((t) => (
                    <div key={t.label}>
                      <div className="text-[10px] muted">{t.label}</div>
                      <div className="text-sm font-semibold tabular-nums">{t.value}</div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {active ? (
              <section className="panel px-3 py-2.5">
                <h2 className="mb-2 text-[11px] font-semibold muted">SESJA</h2>
                <dl className="space-y-1 text-[11px]">
                  <div className="flex justify-between gap-2">
                    <dt className="muted">katalog</dt>
                    <dd className="truncate mono" title={active.cwd}>
                      {active.cwd.split('/').slice(-2).join('/')}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="muted">model</dt>
                    <dd className="mono">{active.model?.replace(/^claude-/, '') ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="muted">uprawnienia</dt>
                    <dd className="mono">{active.permissionMode}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="muted">narzędzia</dt>
                    <dd>{active.tools.length}</dd>
                  </div>
                  {active.todos.length ? (
                    <div className="flex justify-between gap-2">
                      <dt className="muted">zadania sesji</dt>
                      <dd>
                        {active.todos.filter((t) => t.status === 'completed').length}/
                        {active.todos.length}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </section>
            ) : null}
          </aside>
        )}
      </div>

      {toast ? (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg px-3 py-1.5 text-xs"
          style={{ background: 'var(--panel-2)', border: '1px solid var(--border)' }}
        >
          {toast}
        </div>
      ) : null}

      {modal.kind === 'new' ? (
        <NewSession
          defaults={{
            cwd: modal.cwd,
            resume: modal.resume,
            title: modal.title,
            workspaceId: modal.workspaceId,
            terminal: modal.terminal,
          }}
          onClose={() => setModal({ kind: 'none' })}
          onStarted={(info) => {
            setModal({ kind: 'none' })
            setActiveId(info.id)
            setGrid(false)
            deck.reload()
          }}
        />
      ) : null}

      {modal.kind === 'resume' ? (
        <ResumePicker
          onClose={() => setModal({ kind: 'none' })}
          onPick={(s: SessionSummary) => {
            setModal({ kind: 'none' })
            // Nazwa i katalog są znane z transkryptu, więc nie ma o co pytać.
            adopt({
              cwd: s.cwd,
              sessionId: s.sessionId,
              title: s.customTitle || s.summary || s.firstPrompt,
            })
          }}
          onPickWithOptions={(s: SessionSummary) =>
            setModal({
              kind: 'new',
              resume: s.sessionId,
              cwd: s.cwd,
              title: s.customTitle || s.summary,
            })
          }
        />
      ) : null}

      {modal.kind === 'memory' ? (
        <MemoryPanel cwd={active?.cwd} onClose={() => setModal({ kind: 'none' })} />
      ) : null}

      {modal.kind === 'palette' ? (
        <Palette commands={commands} onClose={() => setModal({ kind: 'none' })} />
      ) : null}

      {modal.kind === 'switch' ? (
        <Palette
          commands={sessionCommands}
          title="Przejdź do sesji"
          placeholder="Wpisz fragment nazwy…"
          onClose={() => setModal({ kind: 'none' })}
        />
      ) : null}

      {modal.kind === 'tasks' ? (
        <Overlay
          title="Zadania"
          hint="taskwarrior · Esc zamyka"
          onClose={() => setModal({ kind: 'none' })}
          wide
        >
          <TasksPanel
            sessionId={active?.sessionId}
            onUseAsPrompt={
              active
                ? (text) => {
                    setModal({ kind: 'none' })
                    run(active.id, { action: 'send', text })
                    flash('Wysłano zadanie do sesji')
                  }
                : undefined
            }
          />
        </Overlay>
      ) : null}

      {modal.kind === 'board' ? (
        <Overlay
          title="Tablica zadań"
          hint="przeciągnij kartę między kolumnami · Esc zamyka"
          onClose={() => setModal({ kind: 'none' })}
          wide
        >
          <TaskBoard />
        </Overlay>
      ) : null}

      {modal.kind === 'settings' ? (
        <Overlay
          title={t('Ustawienia')}
          hint={t('język, powiadomienia, zgody, sejf · Esc zamyka')}
          onClose={() => setModal({ kind: 'none' })}
          wide
        >
          <SettingsPanel
            onOpenCalendar={() => {
              setModal({ kind: 'none' })
              openCalendar()
            }}
          />
        </Overlay>
      ) : null}

      {modal.kind === 'calendar' ? (
        <Overlay
          title="Kalendarz"
          hint="przeciągnij zadanie na godzinę · Google i Outlook w obie strony · Esc zamyka"
          onClose={() => setModal({ kind: 'none' })}
          wide
        >
          <CalendarPanel />
        </Overlay>
      ) : null}

      {modal.kind === 'projects' ? (
        <Overlay
          title="Projekty"
          hint="sesje, zadania i zmiany w każdym · Esc zamyka"
          onClose={() => setModal({ kind: 'none' })}
          wide
        >
          <ProjectsPanel
            onOpen={(cwd) => {
              setModal({ kind: 'none' })
              newTerminal(cwd)
            }}
          />
        </Overlay>
      ) : null}

      {modal.kind === 'attention' ? (
        <Overlay
          title="Uwaga i rytm dnia"
          hint="cel, realny czas pracy, przeskoki · Esc zamyka"
          onClose={() => setModal({ kind: 'none' })}
          wide
        >
          <AttentionPanel />
        </Overlay>
      ) : null}

      {modal.kind === 'pulse' ? (
        <Overlay
          title="Puls maszyny"
          hint="usługi i repozytoria · Esc zamyka"
          onClose={() => setModal({ kind: 'none' })}
          wide
        >
          <PulsePanel
            onStartSession={(cwd) => {
              setModal({ kind: 'none' })
              newTerminal(cwd)
            }}
          />
        </Overlay>
      ) : null}

      {modal.kind === 'gitlab' ? (
        <Overlay
          title="GitLab"
          hint="odświeżane co trzy minuty · Esc zamyka"
          onClose={() => setModal({ kind: 'none' })}
          wide
        >
          <GitlabPanel
            onStartSession={
              active
                ? (text) => {
                    setModal({ kind: 'none' })
                    run(active.id, { action: 'send', text })
                    flash('Wysłano do sesji')
                  }
                : undefined
            }
          />
        </Overlay>
      ) : null}

      {modal.kind === 'journal' ? (
        <Overlay
          title="Dziennik dnia"
          hint="sesje, projekty i zamknięte zadania · Esc zamyka"
          onClose={() => setModal({ kind: 'none' })}
          wide
        >
          <JournalPanel />
        </Overlay>
      ) : null}

      {modal.kind === 'search' ? (
        <Overlay
          title="Szukaj w rozmowach"
          hint="wszystkie transkrypty · Esc zamyka"
          onClose={() => setModal({ kind: 'none' })}
          wide
        >
          <SearchPanel
            onOpen={(sessionId) => {
              const open = terminals.find((t) => t.sessionId === sessionId)
              if (open) {
                setModal({ kind: 'none' })
                setActiveId(open.id)
                setGrid(false)
              } else {
                window.open(`/sessions/${sessionId}`, '_blank')
              }
            }}
          />
        </Overlay>
      ) : null}

      {modal.kind === 'help' ? <Help onClose={() => setModal({ kind: 'none' })} /> : null}
    </div>
  )
}
