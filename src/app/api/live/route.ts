import { handle } from '@/lib/api'
import { listLiveSessions, startLiveSession, type StartOptions } from '@/lib/runner'
import { resolveWorkspace, toMcpServerConfig } from '@/lib/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(req: Request) {
  return handle(req, async () => ({ items: listLiveSessions().map((s) => s.info()) }))
}

export async function POST(req: Request) {
  return handle(req, async () => {
    const body = (await req.json()) as {
      /** Start z zapisanej przestrzeni roboczej — repozytoria i MCP biorą się z niej. */
      workspaceId?: string
      cwd?: string
      additionalDirectories?: string[]
      prompt?: string
      model?: string
      permissionMode?: string
      resume?: string
      forkSession?: boolean
      maxTurns?: number
      title?: string
    }
    if (!body.prompt?.trim()) throw new Error('Brak pola "prompt"')

    let opts: StartOptions

    if (body.workspaceId) {
      const { workspace, primary, extras, mcp } = await resolveWorkspace(body.workspaceId)
      opts = {
        cwd: primary.path,
        additionalDirectories: extras.map((r) => r.path),
        mcpServers: toMcpServerConfig(mcp),
        prompt: body.prompt,
        // Wartości z żądania mają pierwszeństwo nad ustawieniami przestrzeni.
        model: body.model || workspace.model,
        permissionMode: body.permissionMode || workspace.permissionMode,
        allowedTools: workspace.allowedTools.length ? workspace.allowedTools : undefined,
        resume: body.resume,
        forkSession: body.forkSession,
        maxTurns: body.maxTurns,
        title: body.title,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
      }
    } else {
      if (!body.cwd) throw new Error('Podaj "cwd" albo "workspaceId"')
      opts = {
        cwd: body.cwd,
        additionalDirectories: body.additionalDirectories ?? [],
        prompt: body.prompt,
        model: body.model,
        permissionMode: body.permissionMode,
        resume: body.resume,
        forkSession: body.forkSession,
        maxTurns: body.maxTurns,
        title: body.title,
      }
    }

    const session = await startLiveSession(opts)
    return session.info()
  })
}
