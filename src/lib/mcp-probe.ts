import { spawn } from 'node:child_process'

import type { McpEntry } from './store'

export type McpProbeResult = {
  name: string
  status: 'connected' | 'failed'
  error?: string
  /** Nazwy narzędzi zgłoszonych przez serwer. */
  tools: string[]
  serverInfo?: { name?: string; version?: string }
  protocolVersion?: string
  durationMs: number
}

const PROTOCOL_VERSION = '2025-06-18'
const CLIENT_INFO = { name: 'claude-session-manager', version: '0.1.0' }

function initializeRequest(id: number) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
  }
}

function toolNames(result: unknown): string[] {
  const tools = (result as { tools?: unknown })?.tools
  if (!Array.isArray(tools)) return []
  return tools
    .map((t) => (t && typeof t === 'object' ? String((t as { name?: unknown }).name ?? '') : ''))
    .filter(Boolean)
}

/* ------------------------------------------------------------------ */
/* Transport stdio                                                     */
/* ------------------------------------------------------------------ */

async function probeStdio(entry: McpEntry, timeoutMs: number): Promise<Partial<McpProbeResult>> {
  if (!entry.command) return { status: 'failed', error: 'Brak polecenia' }

  const child = spawn(entry.command, entry.args ?? [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...(entry.env ?? {}) },
  })

  const pending = new Map<number, (msg: Record<string, unknown>) => void>()
  let stderr = ''
  let buffer = ''
  let spawnError: string | undefined

  child.stderr.on('data', (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-2000)
  })
  child.on('error', (e) => {
    spawnError = e.message
    for (const resolve of pending.values()) resolve({ error: { message: e.message } })
    pending.clear()
  })
  child.on('exit', (code) => {
    if (pending.size) {
      const message = `Proces zakończył się kodem ${code}${stderr ? `: ${stderr.trim()}` : ''}`
      for (const resolve of pending.values()) resolve({ error: { message } })
      pending.clear()
    }
  })

  // Serwery MCP po stdio wymieniają JSON-RPC rozdzielony znakiem nowej linii.
  child.stdout.on('data', (d: Buffer) => {
    buffer += d.toString()
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      try {
        const msg = JSON.parse(line) as Record<string, unknown>
        const resolve = typeof msg.id === 'number' ? pending.get(msg.id) : undefined
        if (resolve) {
          pending.delete(msg.id as number)
          resolve(msg)
        }
      } catch {
        /* linia nie jest JSON-em (np. log serwera) — pomijamy */
      }
    }
  })

  const send = (payload: unknown) => child.stdin.write(JSON.stringify(payload) + '\n')

  const request = (payload: { id: number }) =>
    new Promise<Record<string, unknown>>((resolve) => {
      pending.set(payload.id, resolve)
      send(payload)
    })

  const deadline = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs))

  try {
    const init = await Promise.race([request(initializeRequest(1)), deadline])
    if (init === 'timeout') return { status: 'failed', error: `Przekroczono limit ${timeoutMs / 1000} s` }
    if (init.error) {
      return { status: 'failed', error: String((init.error as { message?: string }).message ?? init.error) }
    }

    send({ jsonrpc: '2.0', method: 'notifications/initialized' })

    const list = await Promise.race([request({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} } as never), deadline])
    const result = init.result as Record<string, unknown> | undefined

    return {
      status: 'connected',
      tools: list === 'timeout' ? [] : toolNames((list as Record<string, unknown>).result),
      serverInfo: result?.serverInfo as McpProbeResult['serverInfo'],
      protocolVersion: result?.protocolVersion as string | undefined,
    }
  } catch (e) {
    return { status: 'failed', error: spawnError ?? (e instanceof Error ? e.message : String(e)) }
  } finally {
    child.stdin.end()
    child.kill('SIGTERM')
    setTimeout(() => child.killed || child.kill('SIGKILL'), 1500).unref?.()
  }
}

/* ------------------------------------------------------------------ */
/* Transport http / sse                                                */
/* ------------------------------------------------------------------ */

/** Odpowiedź może być zwykłym JSON-em albo strumieniem SSE — obsługujemy oba. */
async function readRpcResponse(res: Response): Promise<Record<string, unknown>> {
  const contentType = res.headers.get('content-type') ?? ''
  const text = await res.text()
  if (contentType.includes('text/event-stream')) {
    for (const block of text.split('\n\n')) {
      const dataLine = block.split('\n').find((l) => l.startsWith('data:'))
      if (!dataLine) continue
      try {
        return JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>
      } catch {
        /* kolejny blok */
      }
    }
    throw new Error('Nie udało się odczytać odpowiedzi SSE')
  }
  return JSON.parse(text) as Record<string, unknown>
}

async function probeHttp(entry: McpEntry, timeoutMs: number): Promise<Partial<McpProbeResult>> {
  if (!entry.url) return { status: 'failed', error: 'Brak adresu URL' }

  const signal = AbortSignal.timeout(timeoutMs)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...(entry.headers ?? {}),
  }

  const initRes = await fetch(entry.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(initializeRequest(1)),
    signal,
  })
  if (!initRes.ok) {
    return { status: 'failed', error: `HTTP ${initRes.status} ${initRes.statusText}` }
  }

  const init = await readRpcResponse(initRes)
  if (init.error) {
    return { status: 'failed', error: String((init.error as { message?: string }).message ?? init.error) }
  }

  const sessionId = initRes.headers.get('mcp-session-id')
  if (sessionId) headers['mcp-session-id'] = sessionId

  await fetch(entry.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    signal,
  }).catch(() => undefined)

  let tools: string[] = []
  try {
    const listRes = await fetch(entry.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      signal,
    })
    if (listRes.ok) tools = toolNames((await readRpcResponse(listRes)).result)
  } catch {
    /* serwer bez tools/list — połączenie i tak jest sprawne */
  }

  const result = init.result as Record<string, unknown> | undefined
  return {
    status: 'connected',
    tools,
    serverInfo: result?.serverInfo as McpProbeResult['serverInfo'],
    protocolVersion: result?.protocolVersion as string | undefined,
  }
}

/* ------------------------------------------------------------------ */

/**
 * Sprawdza, czy serwer MCP odpowiada: wykonuje pełny handshake JSON-RPC
 * (`initialize` + `tools/list`) i zwraca listę narzędzi. Nie odpytuje modelu,
 * więc test jest darmowy i szybki.
 */
export async function probeMcpServer(entry: McpEntry, timeoutMs = 20_000): Promise<McpProbeResult> {
  const started = Date.now()
  let partial: Partial<McpProbeResult>
  try {
    partial =
      entry.transport === 'stdio'
        ? await probeStdio(entry, timeoutMs)
        : await probeHttp(entry, timeoutMs)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    partial = {
      status: 'failed',
      error: message.includes('aborted') ? `Przekroczono limit ${timeoutMs / 1000} s` : message,
    }
  }

  return {
    name: entry.name,
    status: partial.status ?? 'failed',
    error: partial.error,
    tools: partial.tools ?? [],
    serverInfo: partial.serverInfo,
    protocolVersion: partial.protocolVersion,
    durationMs: Date.now() - started,
  }
}
