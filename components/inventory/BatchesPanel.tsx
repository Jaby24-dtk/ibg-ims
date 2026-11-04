'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Layers, Plus, Trash2, Edit2, Check, X, Gift, PauseCircle, PlayCircle, Route } from 'lucide-react'
import type { Product, ProductBatch, StorageBin } from '@/types'
import { formatDate } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { moveStock } from '@/lib/stock'
import { HOLD_CODES } from '@/lib/quality'

// Product detail → "Batches & expiry". Each delivery keeps its own batch number + expiry;
// sales / samples / counts take stock from the earliest-expiring UNEXPIRED batch first (FEFO,
// done by the database); expired batches are never used automatically — write them off with the
// bin icon, or give them out on purpose with the gift icon (sample only, never sold).
// Units without a batch are stock received before batches were tracked, or without an expiry.
export default function BatchesPanel({
  product, batches, editable, canHold = editable, canRelease = canHold, locationId, locationLabel, expiryBadge, onStockMoved, onChanged, bins,
}: {
  product: Product
  /** This product's batches, earliest expiry first. */
  batches: ProductBatch[]
  editable: boolean
  /** May put batches on hold (any staff member, SOP 7.3). Defaults to `editable`. */
  canHold?: boolean
  /** May release a hold — the QRP (Settings → Approvals → Hold release & disposition). */
  canRelease?: boolean
  /** Location stock in / write-offs apply to (Shopify-synced products), else null. */
  locationId: string | null
  locationLabel: string
  expiryBadge: (date: string) => React.ReactNode
  onStockMoved: (newQty: number, delta: number) => void
  /** Batches changed — reload them. */
  onChanged: () => void
  /** Storage locations (2026-10-22 migration); null/undefined hides the Location column. */
  bins?: StorageBin[] | null
}) {
  const batched = batches.reduce((s, b) => s + b.quantity, 0)
  const unbatched = Math.max(0, (product.stock_quantity ?? 0) - batched)
  // The batch the next sale / sample comes from: earliest-expiring one that hasn't expired.
  const todayIso = new Date().toISOString().slice(0, 10)
  const useFirstId = batches.find(b => (b.status ?? 'released') === 'released' && (!b.expiry_date || b.expiry_date >= todayIso))?.id
  const [mode, setMode] = useState<null | 'receive' | 'assign'>(null)
  const [form, setForm] = useState({ qty: '', batch: '', expiry: '' })
  const [editId, setEditId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ batch: '', expiry: '', qty: '' })
  const [writeOffId, setWriteOffId] = useState<string | null>(null)
  const [writeOffQty, setWriteOffQty] = useState('')
  const [sampleId, setSampleId] = useState<string | null>(null)
  const [sampleQty, setSampleQty] = useState('')
  const [holdId, setHoldId] = useState<string | null>(null)
  const [holdReason, setHoldReason] = useState('')
  const [holdCode, setHoldCode] = useState('COMPLAINT')
  const [releasing, setReleasing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const binCode = (id: string | null | undefined) => bins?.find(x => x.id === id)?.code ?? ''
  const moveBatch = (b: ProductBatch, binId: string) => run(async () => {
    const { error } = await createClient().from('product_batches').update({ bin_id: binId || null }).eq('id', b.id)
    if (error) throw new Error(error.message)
    onChanged()
  })
  const binCell = (b: ProductBatch | null) => {
    if (!bins) return null
    const current = b ? b.bin_id ?? '' : product.bin_id ?? ''
    if (!b || !editable) {
      return <td style={cell}>{binCode(current) ? <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{binCode(current)}</span> : <span style={{ color: '#DC2626', fontSize: 12 }}>Not set</span>}</td>
    }
    return (
      <td style={cell}>
        <select className="input-field" style={{ padding: '3px 28px 3px 6px', fontSize: 12, fontFamily: 'monospace', minWidth: 120 }}
          value={current} disabled={busy} onChange={e => moveBatch(b, e.target.value)} title="Where this batch is stored">
          <option value="">— Not set —</option>
          {bins.filter(x => x.active || x.id === current).map(x => <option key={x.id} value={x.id}>{x.code}</option>)}
        </select>
      </td>
    )
  }

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
    const qty = parseInt(editForm.qty)
    if (!Number.isFinite(qty) || qty < 1) throw new Error('Enter a quantity of 1 or more (use the bin icon to remove a batch).')
    const sb = createClient()
    if (editForm.batch.trim() !== b.batch_number || (editForm.expiry || null) !== (b.expiry_date ?? null)) {
      const { error } = await sb.from('product_batches')
        .update({ batch_number: editForm.batch.trim(), expiry_date: editForm.expiry || null }).eq('id', b.id)
      if (error) throw new Error(/duplicate|unique/i.test(error.message) ? 'Another batch already has that number and expiry.' : error.message)
    }
    // Quantity correction → stock count adjustment on this batch (logged as a movement).
    const delta = qty - b.quantity
    if (delta !== 0) {
      const label = editForm.batch.trim() || (editForm.expiry ? `exp. ${formatDate(editForm.expiry)}` : 'batch')
      const newQty = await moveStock(sb, {
        productId: product.id, locationId, delta, type: 'adjustment', batchId: b.id,
        notes: `Batch ${label} quantity corrected ${b.quantity} → ${qty}` + (locationId ? ` (${locationLabel})` : ''),
        unitCost: product.unit_cost, sellingPrice: product.selling_price,
      })
      onStockMoved(newQty, delta)
    }
    setEditId(null)
    onChanged()
  })

  const sendSample = (b: ProductBatch) => run(async () => {
    const qty = parseInt(sampleQty)
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('Enter a quantity greater than 0.')
    if (qty > b.quantity) throw new Error(`That batch only has ${b.quantity}.`)
    const label = b.batch_number || (b.expiry_date ? `exp. ${formatDate(b.expiry_date)}` : 'batch')
    try {
      const newQty = await moveStock(createClient(), {
        productId: product.id, locationId, delta: -qty, type: 'sample', batchId: b.id,
        notes: `Sample from expired batch ${label}` + (locationId ? ` (${locationLabel})` : ''),
        unitCost: product.unit_cost, sellingPrice: product.selling_price,
      })
      onStockMoved(newQty, -qty)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Database not updated yet (2026-10-16_expired-samples.sql) still refuses expired samples.
      throw new Error(/expired/i.test(msg) ? 'Sending expired stock as samples isn\'t switched on yet — the database update (2026-10-16_expired-samples.sql) still needs to be run.' : msg)
    }
    setSampleId(null)
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

  // Quality hold / release (approvers; the database checks). Recalled batches change only via their recall.
  // Hold: any staff member, with a reason code (IBG-F02). Release: the QRP, with the rationale (IBG-F11).
  const setStatus = (b: ProductBatch, status: 'on_hold' | 'released', reason: string) => run(async () => {
    const sb = createClient()
    const { error } = status === 'on_hold'
      ? await sb.rpc('batch_hold', { p_batch: b.id, p_code: holdCode, p_reason: reason, p_case: null })
      : await sb.rpc('disposition_record', { p_product: product.id, p_batch_number: b.batch_number, p_expiry: b.expiry_date, p_kind: 'release', p_qty: null, p_rationale: reason })
    if (error) throw new Error(/batch_hold|disposition_record/.test(error.message) ? 'Needs the 2026-10-23_recall-sop.sql database update.' : error.message)
    setHoldId(null); setReleasing(false)
    onChanged()
  })
  const traceHref = (b: ProductBatch) =>
    `/traceability/batch?product=${product.id}&batch=${encodeURIComponent(b.batch_number)}${b.expiry_date ? `&expiry=${b.expiry_date}` : ''}`

  const isExpired = (b: ProductBatch) => !!b.expiry_date && b.expiry_date < todayIso

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
        Each delivery keeps its own expiry. Sales, samples and counts use the earliest-expiring batch first — expired batches are never used automatically. Use the pencil to correct a batch&apos;s quantity, the gift icon to give out expired units as samples, or the bin icon to write them off. The pause icon puts a batch on hold (nothing is sold or sampled from it); the route icon shows its full trace.
      </p>

      {(batches.length > 0 || unbatched > 0) && (
        <table style={{ width: '100%', borderCollapse: 'collapse', background: 'white', borderRadius: 8, overflow: 'hidden', border: '1px solid #E2E8F0' }}>
          <thead>
            <tr style={{ background: '#F1F5F9' }}>
              {['Batch', 'Expiry', ...(bins ? ['Location'] : []), 'Qty', ''].map(h => (
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
                    {bins && <td style={cell} />}
                    <td style={cell}><input type="number" min={1} className="input-field" style={{ width: 72, padding: '4px 6px', fontSize: 12 }} value={editForm.qty} onChange={e => setEditForm(f => ({ ...f, qty: e.target.value }))} /></td>
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
                      {b.status === 'on_hold' && <span className="badge badge-warning" style={{ marginLeft: 6, fontSize: 10 }} title={b.hold_reason ?? ''}>On hold</span>}
                      {b.status === 'recalled' && <span className="badge badge-danger" style={{ marginLeft: 6, fontSize: 10 }} title={b.hold_reason ?? ''}>Recalled</span>}
                    </td>
                    <td style={cell}>
                      {b.expiry_date ? <>{formatDate(b.expiry_date)} <span style={{ marginLeft: 4 }}>{expiryBadge(b.expiry_date)}</span></> : <span style={{ color: '#94A3B8' }}>No expiry</span>}
                    </td>
                    {binCell(b)}
                    <td style={cell}><strong>{b.quantity}</strong></td>
                    <td style={{ ...cell, whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <Link href={traceHref(b)} title="Trace this batch — where it came from and where it went" style={{ display: 'inline-flex', verticalAlign: 'middle' }}>
                        <span style={{ width: 26, height: 26, borderRadius: 6, marginLeft: 4, border: '1px solid #E2E8F0', color: '#64748B', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'white' }}><Route size={13} /></span>
                      </Link>
                      {(editable || canHold) && writeOffId !== b.id && sampleId !== b.id && holdId !== b.id && (
                        <>
                          {canHold && (b.status ?? 'released') === 'released' && (
                            <IconBtn title="Put this batch on hold (nothing is sold or sampled from it)" onClick={() => { setHoldId(b.id); setReleasing(false); setHoldReason(''); setWriteOffId(null); setSampleId(null); setError('') }}><PauseCircle size={13} /></IconBtn>
                          )}
                          {canRelease && b.status === 'on_hold' && (
                            <IconBtn title={`Release from hold${b.hold_reason ? ` (held: ${b.hold_reason})` : ''}`} disabled={busy} onClick={() => { setHoldId(b.id); setReleasing(true); setHoldReason(''); setWriteOffId(null); setSampleId(null); setError('') }}><PlayCircle size={13} /></IconBtn>
                          )}
                          {editable && isExpired(b) && (b.status ?? 'released') === 'released' && (
                            <IconBtn title="Send units from this expired batch as samples" onClick={() => { setSampleId(b.id); setSampleQty('1'); setWriteOffId(null); setError('') }}><Gift size={13} /></IconBtn>
                          )}
                          {editable && <><IconBtn title="Edit batch number, expiry or quantity" onClick={() => { setEditId(b.id); setEditForm({ batch: b.batch_number, expiry: b.expiry_date ?? '', qty: String(b.quantity) }); setError('') }}><Edit2 size={13} /></IconBtn>
                          <IconBtn title="Write off units from this batch" danger onClick={() => { setWriteOffId(b.id); setWriteOffQty(String(b.quantity)); setSampleId(null); setError('') }}><Trash2 size={13} /></IconBtn></>}
                        </>
                      )}
                      {sampleId === b.id && (
                        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                          <input type="number" min={1} max={b.quantity} className="input-field" style={{ width: 64, padding: '4px 6px', fontSize: 12 }} value={sampleQty} onChange={e => setSampleQty(e.target.value)} />
                          <button className="btn-secondary btn-sm" style={{ padding: '4px 8px' }} disabled={busy} onClick={() => sendSample(b)}><Gift size={12} /> Send as sample</button>
                          <IconBtn title="Cancel" onClick={() => setSampleId(null)}><X size={13} /></IconBtn>
                        </span>
                      )}
                      {holdId === b.id && (
                        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                          {!releasing && (
                            <select className="input-field" style={{ width: 120, padding: '4px 6px', fontSize: 12 }} value={holdCode} onChange={e => setHoldCode(e.target.value)}>
                              {HOLD_CODES.map(h => <option key={h.code} value={h.code}>{h.code}</option>)}
                            </select>
                          )}
                          <input className="input-field" style={{ width: 190, padding: '4px 6px', fontSize: 12 }} placeholder={releasing ? 'Inspection result / why release' : 'What happened'} autoFocus value={holdReason} onChange={e => setHoldReason(e.target.value)} />
                          <button className="btn-secondary btn-sm" style={{ padding: '4px 8px' }} disabled={busy || !holdReason.trim()} onClick={() => setStatus(b, releasing ? 'released' : 'on_hold', holdReason)}>{releasing ? <><PlayCircle size={12} /> Release</> : <><PauseCircle size={12} /> Hold</>}</button>
                          <IconBtn title="Cancel" onClick={() => setHoldId(null)}><X size={13} /></IconBtn>
                        </span>
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
                {binCell(null)}
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
