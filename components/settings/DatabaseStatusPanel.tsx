'use client'

import { useEffect, useState, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'

const TABLES = ['products', 'product_batches', 'suppliers', 'purchase_orders', 'purchase_order_items', 'transactions', 'alerts', 'alert_recipients', 'audit_log', 'users', 'categories']

type TableStatus = { state: 'checking' } | { state: 'ok'; count: number | null } | { state: 'error'; message: string }

const configured = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return url.length > 0 && !url.includes('your-project-ref')
})()

// Live check of the Supabase connection: one head-only count query per table.
export default function DatabaseStatusPanel() {
  const [status, setStatus] = useState<Record<string, TableStatus>>({})
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)

  const check = useCallback(async () => {
    if (!configured) return
    setStatus(Object.fromEntries(TABLES.map(t => [t, { state: 'checking' }])))
    const { createClient } = await import('@/lib/supabase/client')
    const sb = createClient()
    const results = await Promise.all(TABLES.map(async t => {
      const { count, error } = await sb.from(t).select('*', { count: 'exact', head: true })
      const s: TableStatus = error ? { state: 'error', message: error.message || 'Not reachable' } : { state: 'ok', count }
      return [t, s] as const
    }))
    setStatus(Object.fromEntries(results))
    setCheckedAt(new Date())
  }, [])

  useEffect(() => { check() }, [check])

  const values = Object.values(status)
  const checking = values.some(s => s.state === 'checking')
  const errors = values.filter(s => s.state === 'error').length
  const connected = configured && !checking && values.length > 0 && errors < TABLES.length

  const banner = !configured
    ? { bg: '#FEF3C7', border: '#FDE68A', title: '#92400E', text: '#78350F', label: 'Not connected', msg: 'Supabase environment variables are not set — the app is running on demo data and nothing is saved.' }
    : checking || values.length === 0
      ? { bg: '#F8FAFC', border: '#E2E8F0', title: '#334155', text: '#475569', label: 'Checking…', msg: 'Contacting the database.' }
      : connected
        ? { bg: '#F0FDF4', border: '#BBF7D0', title: '#15803D', text: '#166534', label: 'Connected — persistent storage active', msg: `All changes are saved to Supabase and shared across devices and users.${errors ? ` ${errors} table${errors === 1 ? '' : 's'} could not be read (see below).` : ''}` }
        : { bg: '#FEE2E2', border: '#FECACA', title: '#991B1B', text: '#7F1D1D', label: 'Connection problem', msg: 'Supabase is configured but no tables could be read. The project may be paused (free plan) — open the Supabase dashboard and restore it.' }

  return (
    <>
      <div style={{ padding: 20, background: banner.bg, borderRadius: 12, border: `1px solid ${banner.border}`, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: banner.title, marginBottom: 4 }}>Connection Status: {banner.label}</div>
          <div style={{ fontSize: 12, color: banner.text }}>{banner.msg}</div>
          {checkedAt && <div style={{ fontSize: 11, color: banner.text, opacity: 0.7, marginTop: 6 }}>Checked {checkedAt.toLocaleTimeString()}</div>}
        </div>
        {configured && (
          <button className="btn-secondary btn-sm" onClick={check} disabled={checking}>
            <RefreshCw size={13} /> {checking ? 'Checking' : 'Re-check'}
          </button>
        )}
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', marginBottom: 10 }}>Database Tables</div>
        {TABLES.map(table => {
          const s = status[table]
          const badge = !configured ? { cls: 'badge-warning', text: 'Demo data' }
            : !s || s.state === 'checking' ? { cls: 'badge-info', text: 'Checking…' }
            : s.state === 'ok' ? { cls: 'badge-success', text: s.count == null ? 'Connected' : `${s.count.toLocaleString()} row${s.count === 1 ? '' : 's'}` }
            : { cls: 'badge-danger', text: 'Unavailable' }
          return (
            <div key={table} title={s?.state === 'error' ? s.message : undefined} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: 10, background: '#F8FAFC', border: '1px solid #F1F5F9', marginBottom: 6 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#2FA6B8', fontWeight: 600 }}>{table}</span>
              <span className={`badge ${badge.cls}`} style={{ fontSize: 10 }}>{badge.text}</span>
            </div>
          )
        })}
      </div>
    </>
  )
}
