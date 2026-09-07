import { randomUUID } from 'node:crypto'

import { defaultModel, defaultPermissionMode, isCwdAllowed } from './config'
import { notify } from './notify'
import { addAllowRule, isAllowed, isDenied, readRules } from './rules'
import { addUsage } from './transcript'
import {
  emptyUsage,
  type LiveEvent,
  type LiveSessionInfo,
  type LiveStatus,
  type McpStatus,
  type PendingPermission,
  type TodoItem,
  type TokenUsage,
} from './types'

/* ------------------------------------------------------------------ */
/* Kolejka wejściowa — zamienia wywołania send() w AsyncIterable        */
/* ------------------------------------------------------------------ */

class Pushable<T> implements AsyncIterable<T> {
  private queue: T[] = []
  private resolvers: ((r: IteratorResult<T>) => void)[] = []
  private done = false

  push(value: T) {
    if (this.done) return
    const resolve = this.resolvers.shift()
    if (resolve) resolve({ value, done: false })
    else this.queue.push(value)
  }

  end() {
    if (this.done) return
    this.done = true
    for (const resolve of this.resolvers) resolve({ value: undefined as never, done: true })
    this.resolvers = []
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        const value = this.queue.shift()
        if (value !== undefined) return Promise.resolve({ value, done: false })
        if (this.done) return Promise.resolve({ value: undefined as never, done: true })
        return new Promise((resolve) => this.resolvers.push(resolve))
      },
      return: (): Promise<IteratorResult<T>> => {
        this.end()
        return Promise.resolve({ value: undefined as never, done: true })
      },
    }
  }
}

/* ------------------------------------------------------------------ */
/* Pojedyncza sesja na żywo                                             */
/* ------------------------------------------------------------------ */

export type StartOptions = {
  cwd: string
  prompt: string
  model?: string
  permissionMode?: string
  resume?: string
  forkSession?: boolean
  allowedTools?: string[]
  maxTurns?: number
  title?: string
  /** Dodatkowe katalogi repozytoriów (tryb multi-repo). */
  additionalDirectories?: string[]
  /** Konfiguracja serwerów MCP: nazwa -> definicja transportu. */
  mcpServers?: Record<string, unknown>
  workspaceId?: string
  workspaceName?: string
}

const MAX_EVENTS = 5000

type Subscriber = (event: LiveEvent) => void

/** Odpowiedź na pytanie o uprawnienie — zgodna strukturalnie z PermissionResult z SDK. */
type PermissionDecision =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message: string }

export class LiveSession {
  readonly id = randomUUID()
  readonly startedAt = Date.now()
  readonly cwd: string
  readonly permissionMode: string
  readonly resumedFrom?: string
  model?: string
  title: string
  sessionId?: string
  status: LiveStatus = 'starting'
  error?: string
  totalCostUsd = 0
  usage: TokenUsage = emptyUsage()
  readonly additionalDirectories: string[]
  readonly workspaceId?: string
  readonly workspaceName?: string
  mcpServers: McpStatus[] = []
  todos: TodoItem[] = []
  /** Przybliżony rozmiar kontekstu ostatniej tury (wejście plus cache). */
  contextTokens = 0
  /** Zsumowany czas tur, czyli realna praca, a nie to, jak długo okno stoi otwarte. */
  activeMs = 0
  private turnStartedAt?: number
  slashCommands: string[] = []
  tools: string[] = []
  activePermissionMode: string

  private queue: string[] = []
  private autoAllow = new Set<string>()
  private events: LiveEvent[] = []
  private seq = 0
  private droppedBefore = 0
  private subscribers = new Set<Subscriber>()
  private input = new Pushable<Record<string, unknown>>()
  private pending = new Map<
    string,
    { req: PendingPermission; resolve: (r: PermissionDecision) => void }
  >()
  private abort = new AbortController()
  private query?: { interrupt(): Promise<unknown>; setPermissionMode(m: string): Promise<void> }

  get startOptions(): StartOptions {
    return this.opts
  }

  constructor(private opts: StartOptions) {
    this.cwd = opts.cwd
    this.permissionMode = opts.permissionMode || defaultPermissionMode()
    this.resumedFrom = opts.resume
    this.model = opts.model || defaultModel()
    this.title = opts.title || opts.prompt.slice(0, 80) || 'Nowa sesja'
    this.additionalDirectories = opts.additionalDirectories ?? []
    this.workspaceId = opts.workspaceId
    this.workspaceName = opts.workspaceName
    this.activePermissionMode = this.permissionMode
    this.mcpServers = Object.keys(opts.mcpServers ?? {}).map((name) => ({
      name,
      status: 'pending',
    }))
  }

  /* --- zdarzenia --- */

  private emit(kind: LiveEvent['kind'], data: Record<string, unknown>) {
    const event: LiveEvent = { seq: this.seq++, at: Date.now(), kind, data }
    this.events.push(event)
    if (this.events.length > MAX_EVENTS) {
      const removed = this.events.splice(0, this.events.length - MAX_EVENTS)
      this.droppedBefore += removed.length
    }
    for (const sub of this.subscribers) {
      try {
        sub(event)
      } catch {
        /* zerwane połączenie SSE — sprzątane przy unsubscribe */
      }
    }
    notifyOverview({ type: 'event', sessionId: this.id, event })
  }

  private setStatus(status: LiveStatus, extra: Record<string, unknown> = {}) {
    this.status = status
    this.emit('status', { status, ...extra })
  }

  eventsSince(cursor: number): LiveEvent[] {
    return this.events.filter((e) => e.seq > cursor)
  }

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn)
    return () => this.subscribers.delete(fn)
  }

  get lastEventAt(): number {
    return this.events.at(-1)?.at ?? this.startedAt
  }

  info(): LiveSessionInfo {
    return {
      id: this.id,
      sessionId: this.sessionId,
      cwd: this.cwd,
      model: this.model,
      permissionMode: this.activePermissionMode,
      status: this.status,
      title: this.title,
      startedAt: this.startedAt,
      lastEventAt: this.lastEventAt,
      eventCount: this.seq,
      totalCostUsd: this.totalCostUsd,
      usage: this.usage,
      pending: [...this.pending.values()].map((p) => p.req),
      error: this.error,
      resumedFrom: this.resumedFrom,
      workspaceId: this.workspaceId,
      workspaceName: this.workspaceName,
      additionalDirectories: this.additionalDirectories,
      mcpServers: this.mcpServers,
      contextTokens: this.contextTokens,
      activeMs: this.activeMs + (this.turnStartedAt ? Date.now() - this.turnStartedAt : 0),
      queued: [...this.queue],
      todos: this.todos,
      autoAllow: [...this.autoAllow],
      slashCommands: this.slashCommands,
      tools: this.tools,
    }
  }

  /* --- sterowanie --- */

  /**
   * Wiadomość od użytkownika. Gdy tura trwa, prompt ląduje w kolejce i pójdzie
   * automatycznie po jej zakończeniu — tak samo jak pisanie w trakcie w terminalu.
   */
  send(text: string, images: string[] = []) {
    if (this.status === 'stopped' || this.status === 'error') {
      throw new Error('Sesja jest zakończona')
    }
    if (this.status === 'idle') {
      this.dispatch(text, images)
      return
    }
    this.queue.push(text)
    this.emit('queued', { text, size: this.queue.length })
  }

  /** Zamienia data URL na blok obrazu w formacie oczekiwanym przez API. */
  private imageBlock(dataUrl: string) {
    const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUrl)
    if (!match) return undefined
    return {
      type: 'image',
      source: { type: 'base64', media_type: match[1], data: match[2] },
    }
  }

  private dispatch(text: string, images: string[] = []) {
    this.turnStartedAt = Date.now()
    this.emit('user-text', { text, images: images.length })
    this.setStatus('running')

    const blocks = [
      ...images.map((i) => this.imageBlock(i)).filter(Boolean),
      { type: 'text', text },
    ]
    this.input.push({
      type: 'user',
      message: { role: 'user', content: blocks },
      parent_tool_use_id: null,
      session_id: this.sessionId ?? '',
    })
  }

  private flushQueue() {
    const next = this.queue.shift()
    if (next === undefined) return
    this.emit('queued', { size: this.queue.length })
    this.dispatch(next)
  }

  /** Usuwa prompt z kolejki (indeks) albo całą kolejkę. */
  unqueue(index?: number) {
    if (index === undefined) this.queue = []
    else this.queue.splice(index, 1)
    this.emit('queued', { size: this.queue.length })
  }

  async interrupt() {
    this.queue = []
    try {
      await this.query?.interrupt()
    } catch (e) {
      this.emit('error', { message: `Przerwanie nie powiodło się: ${String(e)}` })
    }
  }

  async setPermissionMode(mode: string) {
    await this.query?.setPermissionMode(mode)
    this.activePermissionMode = mode
    this.emit('status', { status: this.status, permissionMode: mode })
  }

  resolvePermission(id: string, decision: 'allow' | 'allow-always' | 'deny', message?: string) {
    const entry = this.pending.get(id)
    if (!entry) return false
    this.pending.delete(id)
    if (decision === 'allow-always') {
      this.autoAllow.add(entry.req.ruleKey)
      // Reguła przeżywa sesję — inaczej trzeba jej udzielać w kółko.
      void addAllowRule(entry.req.ruleKey)
    }
    entry.resolve(
      decision === 'deny'
        ? { behavior: 'deny', message: message || 'Odrzucone przez użytkownika' }
        : { behavior: 'allow', updatedInput: entry.req.input }
    )
    this.emit('permission-resolved', {
      id,
      decision,
      toolName: entry.req.toolName,
      ruleKey: entry.req.ruleKey,
    })
    if (this.pending.size === 0 && this.status === 'awaiting-permission') this.setStatus('running')
    return true
  }

  /** Cofa regułę "zawsze zezwalaj". */
  revokeAutoAllow(ruleKey: string) {
    this.autoAllow.delete(ruleKey)
    this.emit('status', { status: this.status })
  }

  stop() {
    this.queue = []
    for (const [id] of this.pending) this.resolvePermission(id, 'deny', 'Sesja zatrzymana')
    this.input.end()
    this.abort.abort()
    this.setStatus('stopped')
  }

  /* --- główna pętla --- */

  async start() {
    const { query } = await import('@anthropic-ai/claude-agent-sdk')

    const q = query({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prompt: this.input as any,
      options: {
        cwd: this.cwd,
        model: this.model,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        permissionMode: this.permissionMode as any,
        allowDangerouslySkipPermissions: this.permissionMode === 'bypassPermissions',
        resume: this.opts.resume,
        forkSession: this.opts.forkSession,
        allowedTools: this.opts.allowedTools,
        maxTurns: this.opts.maxTurns,
        additionalDirectories: this.additionalDirectories,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mcpServers: this.opts.mcpServers as any,
        abortController: this.abort,
        includePartialMessages: false,
        settingSources: ['user', 'project', 'local'],
        canUseTool: async (toolName: string, input: Record<string, unknown>) => {
          // Lista zakazana obowiązuje niezależnie od trybu uprawnień.
          const rules = await readRules()
          const denied = isDenied(rules, toolName, input)
          if (denied) {
            this.emit('permission-resolved', {
              id: '',
              decision: 'deny',
              toolName,
              ruleKey: `zablokowane: ${denied}`,
            })
            return {
              behavior: 'deny' as const,
              message: `Zablokowane regułą panelu: ${denied}`,
            }
          }
          if (isAllowed(rules, permissionRuleKey(toolName, input), toolName, input)) {
            return { behavior: 'allow' as const, updatedInput: input }
          }

          return new Promise<PermissionDecision>((resolve) => {
            const ruleKey = permissionRuleKey(toolName, input)
            if (this.autoAllow.has(ruleKey)) {
              this.emit('permission-resolved', {
                id: '',
                decision: 'auto',
                toolName,
                ruleKey,
              })
              resolve({ behavior: 'allow', updatedInput: input })
              return
            }
            const id = randomUUID()
            const req: PendingPermission = { id, toolName, input, requestedAt: Date.now(), ruleKey }
            this.pending.set(id, { req, resolve })
            this.emit('permission-request', { ...req })
            this.setStatus('awaiting-permission')
            // Sygnał na telefon; treści rozmowy nie wysyłamy, tylko czego dotyczy zgoda.
            void notify({
              title: `${this.title} czeka na zgodę`,
              message: ruleKey,
              priority: 4,
              tags: ['warning'],
            })
          })
        },
        stderr: (data: string) => {
          const text = data.trim()
          if (text) this.emit('error', { stderr: text })
        },
      },
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.query = q as any

    // Pierwszy prompt trafia do kolejki dopiero po zbudowaniu zapytania.
    this.dispatch(this.opts.prompt)

    void (async () => {
      try {
        for await (const msg of q) {
          this.handleMessage(msg as Record<string, unknown>)
        }
        if (this.status !== 'stopped') this.setStatus('stopped')
      } catch (e) {
        if (this.abort.signal.aborted) {
          this.setStatus('stopped')
        } else {
          this.error = e instanceof Error ? e.message : String(e)
          this.emit('error', { message: this.error })
          this.setStatus('error', { message: this.error })
          void notify({
            title: `${this.title}: błąd`,
            message: this.error,
            priority: 4,
            tags: ['rotating_light'],
          })
        }
      }
    })()
  }

  private handleMessage(msg: Record<string, unknown>) {
    const type = msg.type as string

    if (type === 'system' && msg.subtype === 'init') {
      this.sessionId = msg.session_id as string
      this.model = (msg.model as string) || this.model
      if (Array.isArray(msg.mcp_servers)) {
        this.mcpServers = (msg.mcp_servers as Record<string, unknown>[]).map((s) => ({
          name: String(s.name ?? ''),
          status: String(s.status ?? 'unknown'),
        }))
      }
      this.tools = Array.isArray(msg.tools) ? (msg.tools as string[]).map(String) : []
      this.slashCommands = Array.isArray(msg.slash_commands)
        ? (msg.slash_commands as string[]).map(String)
        : []
      this.emit('init', {
        sessionId: this.sessionId,
        model: this.model,
        cwd: msg.cwd,
        tools: msg.tools,
        slashCommands: msg.slash_commands,
        permissionMode: msg.permissionMode,
        mcpServers: this.mcpServers,
        additionalDirectories: this.additionalDirectories,
      })
      this.setStatus('running')
      return
    }

    if (type === 'assistant') {
      const message = msg.message as Record<string, unknown> | undefined
      const content = Array.isArray(message?.content) ? message!.content : []
      for (const block of content as Record<string, unknown>[]) {
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
          this.emit('assistant-text', { text: block.text, uuid: msg.uuid })
        } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
          this.emit('assistant-thinking', { text: block.thinking, uuid: msg.uuid })
        } else if (block.type === 'tool_use') {
          if (block.name === 'TodoWrite') {
            const todos = (block.input as { todos?: TodoItem[] } | undefined)?.todos
            if (Array.isArray(todos)) {
              this.todos = todos
              this.emit('todos', { todos })
            }
          }
          this.emit('tool-use', { id: block.id, name: block.name, input: block.input })
        }
      }
      return
    }

    if (type === 'user') {
      const message = msg.message as Record<string, unknown> | undefined
      const content = Array.isArray(message?.content) ? message!.content : []
      for (const block of content as Record<string, unknown>[]) {
        if (block.type === 'tool_result') {
          this.emit('tool-result', {
            toolUseId: block.tool_use_id,
            isError: block.is_error === true,
            content: truncateContent(block.content),
          })
        }
      }
      return
    }

    if (type === 'result') {
      const cost = typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : 0
      this.totalCostUsd = cost || this.totalCostUsd
      const u = msg.usage as Record<string, unknown> | undefined
      if (u) {
        this.contextTokens =
          (Number(u.input_tokens) || 0) +
          (Number(u.cache_creation_input_tokens) || 0) +
          (Number(u.cache_read_input_tokens) || 0)
        this.usage = addUsage(emptyUsage(), {
          input: Number(u.input_tokens) || 0,
          output: Number(u.output_tokens) || 0,
          cacheCreate: Number(u.cache_creation_input_tokens) || 0,
          cacheRead: Number(u.cache_read_input_tokens) || 0,
        })
      }
      this.emit('result', {
        subtype: msg.subtype,
        isError: msg.is_error === true,
        result: typeof msg.result === 'string' ? msg.result : undefined,
        durationMs: msg.duration_ms,
        numTurns: msg.num_turns,
        totalCostUsd: cost,
      })
      if (this.turnStartedAt) {
        this.activeMs += Date.now() - this.turnStartedAt
        this.turnStartedAt = undefined
      }
      this.setStatus('idle')
      this.flushQueue()
      return
    }
  }
}

function truncateContent(content: unknown, max = 4000): string {
  let text: string
  if (typeof content === 'string') text = content
  else if (Array.isArray(content)) {
    text = content
      .map((b) =>
        b && typeof b === 'object' && 'text' in b ? String((b as { text: unknown }).text) : ''
      )
      .join('\n')
  } else text = JSON.stringify(content)
  return text.length > max ? text.slice(0, max) + `\n… (obcięto ${text.length - max} znaków)` : text
}

/**
 * Klucz reguły "zawsze zezwalaj". Bash zawężamy do pierwszego słowa komendy,
 * żeby zgoda na `git status` nie otwierała drogi dowolnemu `rm`.
 */
export function permissionRuleKey(toolName: string, input: Record<string, unknown>): string {
  if (toolName === 'Bash') {
    const cmd = typeof input.command === 'string' ? input.command.trim() : ''
    const head = cmd.split(/\s+/)[0] ?? ''
    return head ? `Bash(${head})` : 'Bash'
  }
  return toolName
}

/* ------------------------------------------------------------------ */
/* Rejestr — przetrwać hot reload w trybie dev                          */
/* ------------------------------------------------------------------ */

export type OverviewMessage =
  | { type: 'event'; sessionId: string; event: LiveEvent }
  | { type: 'sessions' }

type OverviewSubscriber = (msg: OverviewMessage) => void
type Registry = { sessions: Map<string, LiveSession>; overview: Set<OverviewSubscriber> }

const globalRef = globalThis as unknown as { __csmRunner?: Registry }
const registry: Registry = (globalRef.__csmRunner ??= { sessions: new Map(), overview: new Set() })
registry.overview ??= new Set()

/**
 * Budzi strumień zbiorczy — jedno połączenie SSE obsługuje wszystkie sesje naraz.
 * Osobny strumień na sesję wyczerpałby limit równoległych połączeń przeglądarki.
 */
function notifyOverview(msg: OverviewMessage = { type: 'sessions' }) {
  for (const fn of registry.overview) {
    try {
      fn(msg)
    } catch {
      /* zerwane połączenie — sprzątane przy unsubscribe */
    }
  }
}

export function subscribeOverview(fn: OverviewSubscriber): () => void {
  registry.overview.add(fn)
  return () => registry.overview.delete(fn)
}

export async function startLiveSession(opts: StartOptions): Promise<LiveSession> {
  for (const dir of [opts.cwd, ...(opts.additionalDirectories ?? [])]) {
    if (!isCwdAllowed(dir)) {
      throw new Error(`Katalog ${dir} nie jest na liście dozwolonych (CSM_ALLOWED_ROOTS)`)
    }
  }
  const session = new LiveSession(opts)
  registry.sessions.set(session.id, session)
  await session.start()
  notifyOverview()
  return session
}

export function getLiveSession(id: string): LiveSession | undefined {
  return registry.sessions.get(id)
}

export function listLiveSessions(): LiveSession[] {
  return [...registry.sessions.values()].sort((a, b) => b.lastEventAt - a.lastEventAt)
}

export function removeLiveSession(id: string): boolean {
  const s = registry.sessions.get(id)
  if (!s) return false
  s.stop()
  registry.sessions.delete(id)
  notifyOverview()
  return true
}

/**
 * Wznawia zatrzymaną sesję pod tym samym `sessionId` — odpowiednik `claude --resume`
 * bez wychodzenia z pulpitu. Stara pozycja znika z rejestru.
 */
export async function restartLiveSession(id: string, prompt: string): Promise<LiveSession> {
  const old = registry.sessions.get(id)
  if (!old) throw new Error('Nie znaleziono sesji na żywo')
  if (!old.sessionId) throw new Error('Sesja nie zdążyła się zarejestrować — brak sessionId')
  const fresh = await startLiveSession({
    ...old.startOptions,
    prompt,
    resume: old.sessionId,
    forkSession: false,
  })
  removeLiveSession(id)
  return fresh
}
