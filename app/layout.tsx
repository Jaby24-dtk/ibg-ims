import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'I-BG CT Asia — Inventory Management System',
  description: 'Internal inventory management platform for I-BG CT Asia.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" style={{ height: '100%' }}>
      <body style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
        {children}
      </body>
    </html>
  )
}
