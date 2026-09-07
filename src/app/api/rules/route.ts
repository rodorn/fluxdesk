import { handle } from '@/lib/api'
import { addAllowRule, importFromSettings, readRules, removeAllowRule, writeRules } from '@/lib/rules'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  return handle(req, () => readRules())
}

export async function PUT(req: Request) {
  return handle(req, async () => {
    const body = (await req.json()) as {
      action?: 'add' | 'remove' | 'import' | 'replace'
      rule?: string
      allow?: string[]
      deny?: string[]
    }
    if (body.action === 'import') return importFromSettings()
    if (body.action === 'add' && body.rule) return addAllowRule(body.rule)
    if (body.action === 'remove' && body.rule) return removeAllowRule(body.rule)
    return writeRules({ allow: body.allow, deny: body.deny })
  })
}
