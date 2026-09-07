/** Wspólne typy współdzielone przez serwer i klienta. */

export type SessionSummary = {
  sessionId: string
  summary: string
  lastModified: number
  createdAt?: number
  fileSize?: number
  customTitle?: string
  firstPrompt?: string
  gitBranch?: string
  cwd?: string
  tag?: string
}

export type ProjectSummary = {
  /** Katalog roboczy projektu (odczytany z transkryptów). */
  cwd: string
  /** Nazwa katalogu — do wyświetlenia. */
  name: string
  sessionCount: number
  lastActivity: number
  totalCostUsd: number
  totalTokens: number
}

export type TokenUsage = {
  input: number
  output: number
  cacheCreate: number
  cacheRead: number
}

export const emptyUsage = (): TokenUsage => ({ input: 0, output: 0, cacheCreate: 0, cacheRead: 0 })

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: unknown; is_error?: boolean }
  | { type: 'image'; source?: unknown }
  | { type: string; [k: string]: unknown }

export type TranscriptEntry = {
  uuid: string
  parentUuid: string | null
  role: 'user' | 'assistant' | 'system'
  timestamp?: string
  model?: string
  isSidechain?: boolean
  isMeta?: boolean
  blocks: ContentBlock[]
  usage?: TokenUsage
  costUsd?: number
  /** Nazwa narzędzia dla wpisów systemowych typu hook/notice. */
  systemSubtype?: string
}

export type SessionDetail = {
  sessionId: string
  cwd?: string
  gitBranch?: string
  title: string
  createdAt?: number
  lastModified: number
  models: string[]
  usage: TokenUsage
  costUsd: number
  entryCount: number
  toolCounts: Record<string, number>
  entries: TranscriptEntry[]
}

export type GlobalStats = {
  sessionCount: number
  projectCount: number
  totalCostUsd: number
  usage: TokenUsage
  toolCounts: Record<string, number>
  modelCounts: Record<string, number>
  /** Aktywność dzienna: data ISO (YYYY-MM-DD) -> liczba sesji. */
  daily: { date: string; sessions: number; costUsd: number }[]
  projects: ProjectSummary[]
}

/* ---------- Sesje na żywo ---------- */

export type LiveStatus = 'starting' | 'idle' | 'running' | 'awaiting-permission' | 'stopped' | 'error'

export type LiveEvent = {
  seq: number
  at: number
  kind:
    | 'init'
    | 'assistant-text'
    | 'assistant-thinking'
    | 'tool-use'
    | 'tool-result'
    | 'user-text'
    | 'permission-request'
    | 'permission-resolved'
    | 'result'
    | 'status'
    | 'queued'
    | 'todos'
    | 'error'
  data: Record<string, unknown>
}

export type TodoItem = {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
}

export type PendingPermission = {
  id: string
  toolName: string
  input: Record<string, unknown>
  requestedAt: number
  /** Klucz reguły "zawsze zezwalaj" — dla Bash zawężony do pierwszego słowa komendy. */
  ruleKey: string
}

export type McpStatus = { name: string; status: string }

export type LiveSessionInfo = {
  id: string
  sessionId?: string
  cwd: string
  model?: string
  permissionMode: string
  status: LiveStatus
  title: string
  startedAt: number
  lastEventAt: number
  eventCount: number
  totalCostUsd: number
  usage: TokenUsage
  pending: PendingPermission[]
  error?: string
  resumedFrom?: string
  /** Przestrzeń robocza, z której wystartowano sesję (jeśli była). */
  workspaceId?: string
  workspaceName?: string
  /** Dodatkowe katalogi repozytoriów podpięte do sesji (poza `cwd`). */
  additionalDirectories: string[]
  /** Stan serwerów MCP zgłoszony przez CLI w komunikacie init. */
  mcpServers: McpStatus[]
  /** Przybliżony rozmiar kontekstu ostatniej tury (wejście plus cache). */
  contextTokens: number
  /** Zsumowany czas tur — realna praca, nie czas życia okna. */
  activeMs: number
  /** Prompty czekające w kolejce na zakończenie bieżącej tury. */
  queued: string[]
  /** Ostatni stan listy zadań (TodoWrite). */
  todos: TodoItem[]
  /** Reguły "zawsze zezwalaj" ustawione w tej sesji. */
  autoAllow: string[]
  /** Komendy ukośnikowe zgłoszone przez CLI. */
  slashCommands: string[]
  /** Narzędzia dostępne w sesji. */
  tools: string[]
}
