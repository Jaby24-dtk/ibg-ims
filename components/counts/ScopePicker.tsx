'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { SCOPES, type CountScope } from '@/lib/counts'

export type ScopeOptions = {
  categories: string[]
  brands: string[]
  warehouses: string[]
  sites: { id: string; name: string }[]
  products: { id: string; sku: string; name: string }[]
}

const label: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }

/** "What to count" — shared by the new-count and schedule dialogs. */
export default function ScopePicker({ scope, value, productIds, options, onChange }: {
  scope: CountScope
  value: string
  productIds: string[]
  options: ScopeOptions
  onChange: (next: { scope: CountScope; value: string; productIds: string[] }) => void
}) {
  const [q, setQ] = useState('')
  const choices: Record<'category' | 'brand' | 'warehouse' | 'site', { v: string; l: string }[]> = {
    category: options.categories.map(c => ({ v: c, l: c })),
    brand: options.brands.map(b => ({ v: b, l: b })),
    warehouse: options.warehouses.map(w => ({ v: w, l: w })),
    site: options.sites.map(s => ({ v: s.id, l: s.name })),
  }
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return options.products
      .filter(p => !s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s))
      .slice(0, 200)
  }, [q, options.products])
  const picked = new Set(productIds)

  return (
    <>
      <div>
        <label style={label}>What to count</label>
        <select className="input-field" value={scope} onChange={e => onChange({ scope: e.target.value as CountScope, value: '', productIds })}>
          {SCOPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
      {scope !== 'all' && scope !== 'products' && (
        <div>
          <label style={label}>{SCOPES.find(s => s.value === scope)?.label.replace('One ', 'Which ')}</label>
          <select className="input-field" value={value} onChange={e => onChange({ scope, value: e.target.value, productIds })}>
            <option value="">— Choose —</option>
            {choices[scope].map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
          </select>
          {choices[scope].length === 0 && <div style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>None set up yet.</div>}
        </div>
      )}
      {scope === 'products' && (
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={label}>Products ({productIds.length} chosen)</label>
          <div style={{ position: 'relative', marginBottom: 8 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
            <input className="input-field" style={{ paddingLeft: 32 }} placeholder="Search name or SKU…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #E2E8F0', borderRadius: 10, padding: 6 }}>
            {shown.map(p => (
              <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={picked.has(p.id)} onChange={e => {
                  const next = new Set(picked)
                  if (e.target.checked) next.add(p.id); else next.delete(p.id)
                  onChange({ scope, value, productIds: [...next] })
                }} />
                <span>{p.name}</span><span style={{ color: '#94A3B8', fontFamily: 'monospace', fontSize: 11 }}>{p.sku}</span>
              </label>
            ))}
            {shown.length === 0 && <div style={{ fontSize: 12, color: '#94A3B8', padding: 6 }}>No match.</div>}
          </div>
        </div>
      )}
    </>
  )
}
