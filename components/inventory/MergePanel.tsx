'use client'

import { useState } from 'react'
import { GitMerge } from 'lucide-react'
import type { Product } from '@/types'
import { formatDate } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'

// Product detail → fold a duplicate row of the same item into this one (merge_products RPC):
// its stock + batches (each with its own expiry) move here, its movement history is
// re-pointed, blank details here are filled from it, and the duplicate is deleted
// (snapshot kept in the audit log).
export default function MergePanel({ product, suggestions, allProducts, onMerged }: {
  product: Product
  /** Likely duplicates (same name / barcode), shown first. */
  suggestions: Product[]
  allProducts: Product[]
  onMerged: (removedId: string) => void
}) {
  const [pick, setPick] = useState(suggestions[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const others = allProducts.filter(p => p.id !== product.id && !suggestions.some(s => s.id === p.id))
    .sort((a, b) => a.name.localeCompare(b.name))
  const target = allProducts.find(p => p.id === pick)

  const merge = async () => {
    if (!target) return
    if (!confirm(`Merge "${target.name}" (${target.sku}, ${target.stock_quantity} units) into "${product.name}" (${product.sku})?\n\n` +
      `Its stock and expiry batches move here and "${target.sku}" is deleted. This can't be undone (a snapshot is kept in the audit log).`)) return
    setBusy(true); setError('')
    const { error } = await createClient().rpc('merge_products', { p_keep: product.id, p_merge: target.id })
    setBusy(false)
    if (error) { setError(error.message); return }
    onMerged(target.id)
    setPick('')
  }

  return (
    <div style={{ marginTop: 16, padding: '12px 14px', background: suggestions.length ? '#FFFBEB' : '#F8FAFC', borderRadius: 10, border: `1px solid ${suggestions.length ? '#FDE68A' : '#E2E8F0'}` }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
        <GitMerge size={13} /> {suggestions.length ? `Possible duplicate${suggestions.length > 1 ? 's' : ''} (${suggestions.length})` : 'Merge a duplicate'}
      </div>
      {suggestions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
          {suggestions.map(s => (
            <div key={s.id} style={{ fontSize: 12, color: '#374151' }}>
              <span style={{ fontFamily: 'monospace' }}>{s.sku}</span> · {s.name} · <strong>{s.stock_quantity}</strong> units
              {s.expiry_date && <> · exp. {formatDate(s.expiry_date)}</>}
            </div>
          ))}
        </div>
      )}
      <p style={{ fontSize: 12, color: '#64748B', margin: '0 0 8px' }}>
        Same item listed twice? Merge it into this one. Stock adds up and each keeps its own expiry as a batch.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <select className="input-field" style={{ flex: 1, minWidth: 0 }} value={pick} onChange={e => setPick(e.target.value)}>
          <option value="">Choose the duplicate…</option>
          {suggestions.length > 0 && (
            <optgroup label="Likely duplicates">
              {suggestions.map(p => <option key={p.id} value={p.id}>{p.name} — {p.sku} ({p.stock_quantity})</option>)}
            </optgroup>
          )}
          <optgroup label="All products">
            {others.map(p => <option key={p.id} value={p.id}>{p.name} — {p.sku} ({p.stock_quantity})</option>)}
          </optgroup>
        </select>
        <button className="btn-secondary btn-sm" disabled={!target || busy} onClick={merge}>
          <GitMerge size={13} /> {busy ? 'Merging…' : 'Merge here'}
        </button>
      </div>
      {error && <div style={{ marginTop: 8, fontSize: 12, color: '#991B1B' }}>{error}</div>}
    </div>
  )
}
