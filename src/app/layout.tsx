import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'

import './globals.css'
import { Nav } from '@/components/Nav'

// Ta sama para krojów co na fluxlab.pl.
const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin', 'latin-ext'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin', 'latin-ext'] })

export const metadata: Metadata = {
  title: 'Fluxdesk',
  description: 'Pulpit sterowania sesjami Claude Code, część zestawu Fluxlab',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#6366f1',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen">
        <div className="flex min-h-screen flex-col md:flex-row">
          <Nav />
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </body>
    </html>
  )
}
