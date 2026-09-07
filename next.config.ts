import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /*
   * Katalog buildu bierzemy ze zmiennej, bo nad projektem pracuje kilka sesji
   * naraz. Wspólny `.next` powodował, że przebudowa w jednej wywracała panel
   * uruchomiony z drugiej.
   */
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Agent SDK spawns the Claude Code CLI as a child process — nie może być
  // bundlowany przez webpack/turbopack, musi zostać zwykłym require z node_modules.
  serverExternalPackages: ['@anthropic-ai/claude-agent-sdk'],
  experimental: {
    // Duże transkrypty potrafią przekroczyć domyślny limit odpowiedzi Server Actions.
    proxyTimeout: 120_000,
  },
}

export default nextConfig
