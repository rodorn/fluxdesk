import os from 'node:os'
import path from 'node:path'

/** Katalog konfiguracyjny Claude Code (domyślnie ~/.claude). */
export function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
}

/** Katalog z transkryptami sesji: ~/.claude/projects */
export function projectsDir(): string {
  return path.join(claudeConfigDir(), 'projects')
}

/**
 * Katalogi, w których wolno uruchamiać nowe sesje.
 * Pusta lista = brak ograniczeń (tryb lokalny na localhoscie).
 */
export function allowedRoots(): string[] {
  const raw = process.env.CSM_ALLOWED_ROOTS
  if (!raw) return []
  return raw
    .split(':')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => path.resolve(s))
}

/** Czy dany katalog roboczy jest dopuszczony do uruchomienia sesji. */
export function isCwdAllowed(cwd: string): boolean {
  const roots = allowedRoots()
  if (roots.length === 0) return true
  const resolved = path.resolve(cwd)
  return roots.some((root) => resolved === root || resolved.startsWith(root + path.sep))
}

export function defaultModel(): string | undefined {
  return process.env.CSM_DEFAULT_MODEL || undefined
}

export function defaultPermissionMode(): string {
  return process.env.CSM_DEFAULT_PERMISSION_MODE || 'default'
}

/** Token dostępu; gdy ustawiony, API wymaga nagłówka x-csm-token lub ciasteczka. */
export function accessToken(): string | undefined {
  return process.env.CSM_ACCESS_TOKEN || undefined
}
