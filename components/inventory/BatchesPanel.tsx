'use client'

import { useState } from 'react'
import { Layers, Plus, Trash2, Edit2, Check, X } from 'lucide-react'
import type { Product, ProductBatch } from '@/types'
import { formatDate } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { moveStock } from '@/lib/stock'

// Product detail → "Batches & expiry". Each delivery keeps its own batch number + expiry;
// sales / samples / counts take stock from the earliest-expiring UNEXPIRED batch first (FEFO,
// done by the database); expired batches are never sent out — write them off with the bin icon.
// Units without a batch are stock received before batches were tracked, or without an expiry.
export default function BatchesPanel({
  product, batches, editable, locationId, locationLabel, expiryBadge, onStockMoved, onChanged,
}: {
  product: Product
  /** This product's batches, earliest expiry first. */
  batches: ProductBatch[]
  editable: boolean
  /** Location stock in / write-offs apply to (Shopify-synced products), else null. */
  locationId: string | null
  locationLabel: string
  expiryBadge: (date: string) => React.ReactNode
  onStockMoved: (newQty: number, delta: number) => void
  /** Batches changed — reload them. */
  onChanged: () => void
}) {
  const batched = batches.reduce((s, b) => s + b.quantity, 0)
  const unbatched = Math.max(0, (product.stock_quantity ?? 0) - batched)
  // The batch the next sale / sample comes from: earliest-expiring one that hasn't expired.
  const todayIso = new Date().toISOString().slice(0, 10)
  const useFirstId = batches.find(b => !b.expiry_date || b.expiry_date >= todayIso)?.id
  const [mode, setMode] = useState<null | 'receive' | 'assign'>(null)
  const [form, setForm] = useState({ qty: '', batch: '', expiry: '' })
  const [editId, setEditId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ batch: '', expiry: '' })
  const [writeOffId, setWriteOffId] = useState<string | null>(null)
  const [writeOffQty, setWriteOffQty] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const openForm = (m: 'receive' | 'assign') => {
    setMode(m); setError('')
    setForm({ qty: m === 'assign' ? String(unbatched) : '', batch: '', expiry: '' })
  }

  const submitForm = () => run(async () => {
    const qty = parseInt(form.qty)
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('Enter a quantity greater than 0.')
    if (!form.expiry && !form.batch.trim()) throw new Error('Enter an expiry date or a batch number.')
    const sb = createClient()
    if (mode === 'receive') {
      const newQty = await moveStock(sb, {
        productId: product.id, locationId, delta: qty, type: 'inbound',
        batchNumber: form.batch.trim(), expiryDate: form.expiry || null,
        notes: `Stock received — batch ${form.batch.trim() || '—'}, expiry ${form.expiry ? formatDate(form.expiry) : '—'}` + (locationId ? ` (${locationLabel})` : ''),
        unitCost: product.unit_cost, sellingPrice: product.selling_price,
      })
      onStockMoved(newQty, qty)
    } else {
      if (qty > unbatched) throw new Error(`Only ${unbatched} unit(s) have no batch.`)
      const existing = batches.find(b => b.batch_number === form.batch.trim() && (b.expiry_date ?? '') === form.expiry)
      const { error } = existing
        ? await sb.from('product_batches').update({ quantity: existing.quantity + qty }).eq('id', existing.id)
        : await sb.from('product_batches').insert({ product_id: product.id, batch_number: form.batch.trim(), expiry_date: form.expiry || null, quantity: qty })
      if (error) throw new Error(error.message)
    }
    setMode(null)
    onChanged()
  })

  const saveEdit = (b: ProductBatch) => run(async () => {
    if (!editForm.expiry && !editForm.batch.trim()) throw new Error('A batch needs an expiry date or a batch number.')
    const { error } = await createClient().from('product_batches')
      .update({ batch_number: editForm.batch.trim(), expiry_date: editForm.expiry || null }).eq('id', b.id)
    if (error) throw new Error(/duplicate|unique/i.test(error.message) ? 'Another batch already has that number and expiry.' : error.message)
    setEditId(null)
    onChanged()
  })

  const writeOff = (b: ProductBatch) => run(async () => {
    const qty = parseInt(writeOffQty)
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('Enter a quantity greater than 0.')
    if (qty > b.quantity) throw new Error(`That batch only has ${b.quantity}.`)
    const label = b.batch_number || (b.expiry_date ? `exp. ${formatDate(b.expiry_date)}` : 'batch')
    const expired = b.expiry_date && new Date(b.expiry_date) < new Date()
    const newQty = await moveStock(createClient(), {
      productId: product.id, locationId, delta: -qty, type: 'adjustment', batchId: b.id,
      notes: `Written off from batch ${label}${expired ? ' (expired)' : ''}` + (locationId ? ` (${locationLabel})` : ''),
      unitCost: product.unit_cost, sellingPrice: product.selling_price,
    })
    onStockMoved(newQty, -qty)
    setWriteOffId(null)
    onChanged()
  })

  const cell: React.CSSProperties = { padding: '8px 10px', fontSize: 13, color: '#374151', borderTop: '1px solid #F1F5F9' }

  return (
    <div style={{ marginTop: 16, padding: '12px 14px', background: '#F8FAFC', borderRadius: 10, border: '1px solid #E2E8F0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <Layers size={13} style={{ color: '#2FA6B8' }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: '#1E7A8A', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Batches &amp; expiry</span>
        {editable && mode === null && (
          <button className="btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => openForm('receive')}>
            <Plus size={13} /> Receive stock
          </button>
        )}
      </div>
      <p style={{ fontSize: 12, color: '#64748B', margin: '0 0 8px' }}>
        Each delivery keeps its own expiry. Sales, samples and counts use the earliest-expiring batch first — expired batches are never used; write them off with the bin icon.
      </p>

      {(batches.length > 0 || unbatched > 0) && (
        <table style={{ width: '100%', borderCollapse: 'collapse', background: 'white', borderRadius: 8, overflow: 'hidden', border: '1px solid #E2E8F0' }}>
          <thead>
            <tr style={{ background: '#F1F5F9' }}>
              {['Batch', 'Expiry', 'Qty', ''].map(h => (
                <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {batches.map((b, i) => (
              <tr key={b.id}>
                {editId === b.id ? (
                  <>
                    <td style={cell}><input className="input-field" style={{ padding: '4px 8px', fontSize: 12 }} value={editForm.batch} placeholder="Batch no." onChange={e => setEditForm(f => ({ ...f, batch: e.target.value }))} /></td>
                    <td style={cell}><input type="date" className="input-field" style={{ padding: '4px 8px', fontSize: 12 }} value={editForm.expiry} onChange={e => setEditForm(f => ({ ...f, expiry: e.target.value }))} /></td>
                    <td style={cell}><strong>{b.quantity}</strong></td>
                    <td style={{ ...cell, whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <IconBtn title="Save" disabled={busy} onClick={() => saveEdit(b)}><Check size={13} /></IconBtn>
                      <IconBtn title="Cancel" onClick={() => setEditId(null)}><X size={13} /></IconBtn>
                    </td>
                  </>
                ) : (
                  <>
                    <td style={cell}>
                      <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{b.batch_number || '—'}</span>
                      {b.id === useFirstId && batches.length > 1 && <span className="badge badge-info" style={{ marginLeft: 6, fontSize: 10 }}>Use first</span>}
                    </td>
                    <td style={cell}>
                      {b.expiry_date ? <>{formatDate(b.expiry_date)} <span style={{ marginLeft: 4 }}>{expiryBadge(b.expiry_date)}</span></> : <span style={{ color: '#94A3B8' }}>No expiry</span>}
                    </td>
                    <td style={cell}><strong>{b.quantity}</strong></td>
                    <td style={{ ...cell, whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {editable && writeOffId !== b.id && (
                        <>
                          <IconBtn title="Edit batch number / expiry" onClick={() => { setEditId(b.id); setEditForm({ batch: b.batch_number, expiry: b.expiry_date ?? '' }); setError('') }}><Edit2 size={13} /></IconBtn>
                          <IconBtn title="Write off units from this batch" danger onClick={() => { setWriteOffId(b.id); setWriteOffQty(String(b.quantity)); setError('') }}><Trash2 size={13} /></IconBtn>
                        </>
                      )}
                      {writeOffId === b.id && (
                        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                          <input type="number" min={1} max={b.quantity} className="input-field" style={{ width: 64, padding: '4px 6px', fontSize: 12 }} value={writeOffQty} onChange={e => setWriteOffQty(e.target.value)} />
                          <button className="btn-secondary btn-sm" style={{ color: '#DC2626', borderColor: '#FECACA', padding: '4px 8px' }} disabled={busy} onClick={() => writeOff(b)}>Write off</button>
                          <IconBtn title="Cancel" onClick={() => setWriteOffId(null)}><X size={13} /></IconBtn>
                        </span>
                      )}
                    </td>
                  </>
                )}
              </tr>
            ))}
            {unbatched > 0 && (
              <tr>
                <td style={{ ...cell, color: '#94A3B8' }}>No batch</td>
                <td style={{ ...cell, color: '#94A3B8' }}>Not recorded</td>
                <td style={cell}><strong>{unbatched}</strong></td>
                <td style={{ ...cell, textAlign: 'right' }}>
                  {editable && mode === null && (
                    <button className="btn-secondary btn-sm" style={{ padding: '4px 8px' }} onClick={() => openForm('assign')}>Set expiry</button>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {batches.length === 0 && unbatched === 0 && (
        <div style={{ fontSize: 13, color: '#94A3B8' }}>No stock.</div>
      )}

      {mode && (
        <div style={{ marginTop: 10, padding: 10, background: 'white', borderRadius: 8, border: '1px solid #A5F3FC' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#0F172A', marginBottom: 8 }}>
            {mode === 'receive' ? `Receive new stock${locationId ? ` at ${locationLabel}` : ''}` : 'Set the expiry of units that have no batch'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr', gap: 8 }}>
            <input type="number" min={1} className="input-field" placeholder="Qty" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} />
            <input className="input-field" placeholder="Batch no. (optional)" value={form.batch} onChange={e => setForm(f => ({ ...f, batch: e.target.value }))} />
            <input type="date" className="input-field" value={form.expiry} onChange={e => setForm(f => ({ ...f, expiry: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="btn-secondary btn-sm" onClick={() => setMode(null)}>Cancel</button>
            <button className="btn-primary btn-sm" disabled={busy} onClick={submitForm}>{busy ? 'Saving…' : mode === 'receive' ? 'Add to stock' : 'Save'}</button>
          </div>
        </div>
      )}
      {error && <div style={{ marginTop: 8, fontSize: 12, color: '#991B1B' }}>{error}</div>}
    </div>
  )
}

function IconBtn({ children, title, onClick, disabled, danger }: { children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button title={title} onClick={onClick} disabled={disabled} style={{
      width: 26, height: 26, borderRadius: 6, marginLeft: 4, cursor: 'pointer', background: 'white',
      border: `1px solid ${danger ? '#FECACA' : '#E2E8F0'}`, color: danger ? '#DC2626' : '#64748B',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', verticalAlign: 'middle',
    }}>{children}</button>
  )
}
