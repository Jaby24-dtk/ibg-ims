'use client'

import { useEffect } from 'react'

// Keeps the sidebar/header up when a page crashes and shows the actual error,
// instead of Next's generic full-screen "This page couldn't load".
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error) }, [error])

  return (
    <div className="card" style={{ padding: 32, maxWidth: 560, margin: '40px auto', textAlign: 'center' }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A' }}>Something went wrong on this page</h2>
      <p style={{ fontSize: 13, color: '#64748B', marginTop: 8 }}>
        Try again. If it keeps happening, send this message to support:
      </p>
      <pre style={{
        fontSize: 12, color: '#B91C1C', background: '#FEF2F2', borderRadius: 8, padding: 12,
        marginTop: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', textAlign: 'left',
      }}>
        {error.message || 'Unknown error'}{error.digest ? `\n(ref ${error.digest})` : ''}
      </pre>
      <button className="btn-primary btn-sm" style={{ marginTop: 16 }} onClick={() => reset()}>Try again</button>
    </div>
  )
}
