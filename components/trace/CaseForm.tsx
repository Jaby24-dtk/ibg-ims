'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, MessageSquareWarning, AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { CASE_CATEGORIES, CHANNELS, REPORTER_TYPES, safetyFlag, type QualityCase, type Yn } from '@/lib/quality'

const label: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }

/** IBG-F01 Parts A–C: anyone on staff logs a complaint or an internal nonconformity (SOP 10 A1–A4, 11 B1). */
export default function CaseForm({ onClose, initial }: { onClose: () => void; initial?: { productId?: string; batchNumber?: string; kind?: 'complaint' | 'nonconformity' } }) {
  const router = useRouter()
  const [products, setProducts] = useState<{ id: string; name: string; sku: string | null }[]>([])
  const [batches, setBatches] = useState<string[]>([])
  const [f, setF] = useState({
    kind: initial?.kind ?? 'complaint', channel: 'Phone', reporter_type: 'Consumer', reporter_name: '', reporter_contact: '', order_ref: '',
    product_id: initial?.productId ?? '', batch_number: initial?.batchNumber ?? '', serial_no: '', qty_affected: '1', purchase_date: '',
    category: 'malfunction', description: '', event_date: '', used_on_patient: 'unknown' as Yn, injury: 'no' as Yn, injury_details: '',
    overheating: 'no' as 'yes' | 'no', advice_given: 'Stop using the device; keep the device, packaging and batteries; do not attempt repair; seek medical advice if unwell.',
    photos: false, sample: false,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof f, v: string | boolean) => setF(s => ({ ...s, [k]: v }))

  useEffect(() => {
    createClient().from('products').select('id, name, sku').order('name').then(({ data }) => setProducts((data ?? []) as typeof products))
  }, [])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the batch list when the product is cleared
    if (!f.product_id) { setBatches([]); return }
    createClient().from('batch_index').select('batch_number').eq('product_id', f.product_id)
      .then(({ data }) => setBatches([...new Set(((data ?? []) as { batch_number: string }[]).map(b => b.batch_number).filter(Boolean))]))
  }, [f.product_id])

  const flagged = safetyFlag({ injury: f.injury, overheating: f.overheating, used_on_patient: f.used_on_patient, category: f.category })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!f.description.trim()) { setError('Describe the problem.'); return }
    setBusy(true); setError('')
    const sb = createClient()
    const { data: auth } = await sb.auth.getUser()
    const row: Partial<QualityCase> = {
      kind: f.kind as QualityCase['kind'], channel: f.kind === 'nonconformity' ? 'Internal' : f.channel,
      reporter_type: f.kind === 'nonconformity' ? 'Internal' : f.reporter_type, reporter_name: f.reporter_name || null,
      reporter_contact: f.reporter_contact || null, order_ref: f.order_ref || null, product_id: f.product_id || null,
      batch_number: f.batch_number.trim() || null, serial_no: f.serial_no || null, qty_affected: parseInt(f.qty_affected, 10) || null,
      purchase_date: f.purchase_date || null, category: f.category, description: f.description.trim(), event_date: f.event_date || null,
      used_on_patient: f.used_on_patient, injury: f.injury, injury_details: f.injury_details || null, overheating: f.overheating,
      advice_given: f.advice_given || null, evidence: [f.photos && 'photos', f.sample && 'sample'].filter(Boolean) as string[],
      received_by: auth.user?.id ?? null,
      // Any health effect or inaccurate-reading allegation always gets a IBG-F13 assessment (SOP A6).
      ae_required: flagged || f.used_on_patient === 'yes' ? true : null,
    }
    const { data, error } = await sb.from('quality_cases').insert(row).select('id').single()
    setBusy(false)
    if (error) { setError(/quality_cases/.test(error.message) ? 'Needs the 2026-10-23_recall-sop.sql database update.' : error.message); return }
    fetch('/api/notifications/send', { method: 'POST' }).catch(() => {})
    router.push(`/traceability/cases/${data.id}`)
  }

  const yn = (k: 'used_on_patient' | 'injury', withUnknown = true) => (
    <select className="input-field" value={f[k]} onChange={e => set(k, e.target.value)}>
      <option value="no">No</option><option value="yes">Yes</option>{withUnknown && <option value="unknown">Unknown</option>}
    </select>
  )
  const complaint = f.kind === 'complaint'

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <form onSubmit={submit} className="modal-box" style={{ width: '100%', maxWidth: 720, padding: 28, position: 'relative', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, maxHeight: '92vh', overflowY: 'auto' }}>
        <button type="button" onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}><X size={18} /></button>
        <div style={{ gridColumn: '1 / -1' }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 8 }}><MessageSquareWarning size={18} style={{ color: '#D97706' }} /> Log a complaint or defect (IBG-F01)</h3>
          <p style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>Log it the same business day. Treat any allegation about quality, safety, accuracy or performance as a complaint — even if informal. The QRP is notified at once.</p>
        </div>
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
          {(['complaint', 'nonconformity'] as const).map(k => (
            <button type="button" key={k} className={f.kind === k ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => set('kind', k)}>
              {k === 'complaint' ? 'Customer / external complaint' : 'Internal finding (damaged, spoiled, wrong label…)'}
            </button>
          ))}
        </div>

        {complaint && <>
          <div><label style={label}>Channel</label><select className="input-field" value={f.channel} onChange={e => set('channel', e.target.value)}>{CHANNELS.map(c => <option key={c}>{c}</option>)}</select></div>
          <div><label style={label}>Reporter type</label><select className="input-field" value={f.reporter_type} onChange={e => set('reporter_type', e.target.value)}>{REPORTER_TYPES.map(c => <option key={c}>{c}</option>)}</select></div>
          <div><label style={label}>Reporter name</label><input className="input-field" value={f.reporter_name} onChange={e => set('reporter_name', e.target.value)} /></div>
          <div><label style={label}>Contact (phone / email)</label><input className="input-field" value={f.reporter_contact} onChange={e => set('reporter_contact', e.target.value)} /></div>
          <div><label style={label}>Invoice / order no.</label><input className="input-field" value={f.order_ref} onChange={e => set('order_ref', e.target.value)} /></div>
          <div><label style={label}>Purchase date</label><input className="input-field" type="date" value={f.purchase_date} onChange={e => set('purchase_date', e.target.value)} /></div>
        </>}

        <div style={{ gridColumn: '1 / -1' }}>
          <label style={label}>Product</label>
          <select className="input-field" value={f.product_id} onChange={e => set('product_id', e.target.value)}>
            <option value="">— Choose —</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` · ${p.sku}` : ''}</option>)}
          </select>
        </div>
        <div>
          <label style={label}>Batch / lot</label>
          <input className="input-field" list="case-batches" placeholder="From the label" value={f.batch_number} onChange={e => set('batch_number', e.target.value)} />
          <datalist id="case-batches">{batches.map(b => <option key={b} value={b} />)}</datalist>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}><label style={label}>Serial no.</label><input className="input-field" value={f.serial_no} onChange={e => set('serial_no', e.target.value)} /></div>
          <div style={{ width: 90 }}><label style={label}>Qty</label><input className="input-field" type="number" min={1} value={f.qty_affected} onChange={e => set('qty_affected', e.target.value)} /></div>
        </div>
        <div><label style={label}>Category</label><select className="input-field" value={f.category} onChange={e => set('category', e.target.value)}>{CASE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
        <div><label style={label}>Date of event</label><input className="input-field" type="date" value={f.event_date} onChange={e => set('event_date', e.target.value)} /></div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={label}>Description of the problem</label>
          <textarea className="input-field" rows={3} value={f.description} onChange={e => set('description', e.target.value)} placeholder="What happened, readings observed, error codes, condition of packaging…" />
        </div>

        <div style={{ gridColumn: '1 / -1', fontSize: 12, fontWeight: 700, color: '#0F172A', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 4 }}>Safety screen</div>
        <div><label style={label}>Used on a patient?</label>{yn('used_on_patient')}</div>
        <div><label style={label}>Anyone injured or treated, or a clinical decision made on the reading?</label>{yn('injury')}</div>
        <div><label style={label}>Overheating, smoke, spark or leak?</label><select className="input-field" value={f.overheating} onChange={e => set('overheating', e.target.value)}><option value="no">No</option><option value="yes">Yes</option></select></div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', fontSize: 13, paddingBottom: 10 }}>
          <label style={{ display: 'flex', gap: 6 }}><input type="checkbox" checked={f.photos} onChange={e => set('photos', e.target.checked)} /> Photos received</label>
          <label style={{ display: 'flex', gap: 6 }}><input type="checkbox" checked={f.sample} onChange={e => set('sample', e.target.checked)} /> Sample received</label>
        </div>
        {(f.injury === 'yes' || f.injury === 'unknown') && (
          <div style={{ gridColumn: '1 / -1' }}><label style={label}>Details (who, what treatment / decision, outcome)</label><input className="input-field" value={f.injury_details} onChange={e => set('injury_details', e.target.value)} /></div>
        )}
        {flagged && (
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, padding: '10px 12px', borderRadius: 10, background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', fontSize: 13 }}>
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span><b>Escalate as Critical.</b> The QRP and MD are alerted when you save — also phone them (target: within 1 hour). Tell the customer to stop using the device.</span>
          </div>
        )}
        {complaint && (
          <div style={{ gridColumn: '1 / -1' }}><label style={label}>Advice given to the customer (QRP-approved script only — no diagnosis, no admission of liability)</label><input className="input-field" value={f.advice_given} onChange={e => set('advice_given', e.target.value)} /></div>
        )}
        {error && <div style={{ gridColumn: '1 / -1', padding: '10px 14px', background: '#FEE2E2', borderRadius: 10, fontSize: 12, color: '#991B1B', fontWeight: 600 }}>{error}</div>}
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
          <button type="button" className="btn-secondary btn-sm" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary btn-sm" style={{ flex: 1, justifyContent: 'center' }} disabled={busy}>{busy ? 'Saving…' : 'Log case'}</button>
        </div>
      </form>
    </div>
  )
}
