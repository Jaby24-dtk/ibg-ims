'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, Siren } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatDate } from '@/lib/utils'
import { BATCH_STATUS, SOURCES, type BatchIndexRow, type Recall, type RecallSource } from '@/lib/trace'
import { ACTION_TYPES, DECISION_RULE, PROBABILITIES, SEVERITIES, TRIAGE, riskLevel, type ActionType, type Triage } from '@/lib/quality'

const label: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }
const key = (b: { batch_number: string; expiry_date: string | null }) => `${b.batch_number}|${b.expiry_date ?? ''}`

/** Open a recall / FSCA or a mock recall (SOP 13–14, 23): product + batches, reason, risk level, action type. */
export default function RecallForm({ index, initial, onClose }: {
  index: BatchIndexRow[]
  initial?: { productId: string; batches: { batch_number: string; expiry_date: string | null }[]; caseId?: string; mock?: boolean }
  onClose: () => void
}) {
  const router = useRouter()
  const products = useMemo(() => {
    const m = new Map<string, { id: string; name: string; sku: string | null }>()
    for (const r of index) if (!m.has(r.product_id)) m.set(r.product_id, { id: r.product_id, name: r.product_name, sku: r.sku })
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [index])
  const [productId, setProductId] = useState(initial?.productId ?? '')
  const [picked, setPicked] = useState<Set<string>>(new Set((initial?.batches ?? []).map(key)))
  const [title, setTitle] = useState('')
  const [reason, setReason] = useState('')
  const [source, setSource] = useState<RecallSource>(initial?.caseId ? 'customer_complaint' : 'supplier')
  const [action, setAction] = useState<ActionType>(initial?.mock ? 'mock' : 'recall')
  const [sev, setSev] = useState('')
  const [prob, setProb] = useState('')
  const [triage, setTriage] = useState<Triage | ''>('')
  const [immediate, setImmediate] = useState(false)
  const mock = action === 'mock'
  const suggested = riskLevel(sev, prob)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const batches = index.filter(r => r.product_id === productId)
    .sort((a, b) => (a.expiry_date ?? '9999').localeCompare(b.expiry_date ?? '9999') || a.batch_number.localeCompare(b.batch_number))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const chosen = batches.filter(b => picked.has(key(b)))
    if (!productId) { setError('Choose the product.'); return }
    if (!chosen.length) { setError('Tick at least one batch.'); return }
    if (!reason.trim()) { setError('Give the reason.'); return }
    const level = (triage || suggested) as Triage | null
    if (!mock && !level) { setError('Set the risk level (severity × probability, or choose it).'); return }
    const name = products.find(p => p.id === productId)?.name ?? ''
    const labels = chosen.map(b => b.batch_number || '(no number)').join(', ')
    if (!confirm(mock
      ? `Start a mock recall on ${name}, batch ${labels}? The batch gets a MOCK test hold (released when the exercise closes). Nobody else is told.`
      : `Open ${ACTION_TYPES[action].label.toLowerCase()} for ${name}, batch ${labels}? The stock is blocked straight away and staff are told to stop sale.${immediate ? ' It is ACTIVATED now for immediate safety containment.' : ' The MD is asked to authorise the strategy (IBG-F04).'}`)) return
    setBusy(true); setError('')
    const sb = createClient()
    const { data, error } = await sb.rpc('recall_open', {
      p_title: title, p_reason: reason, p_source: source, p_severity: null, p_product: productId,
      p_batches: chosen.map(b => ({ batch_number: b.batch_number, expiry_date: b.expiry_date })),
      p_action_type: action, p_triage: level, p_case: initial?.caseId ?? null, p_immediate: !mock && immediate,
    })
    if (!error && (sev || prob)) {
      const r = (Array.isArray(data) ? data[0] : data) as Recall
      await sb.rpc('recall_update', { p_recall: r.id, p_patch: { risk_severity: sev || null, risk_probability: prob || null } })
    }
    setBusy(false)
    if (error) { setError(/recall_open/.test(error.message) ? 'Needs the 2026-10-23_recall-sop.sql database update.' : error.message); return }
    fetch('/api/notifications/send', { method: 'POST' }).catch(() => {})
    const r = (Array.isArray(data) ? data[0] : data) as Recall
    router.push(`/traceability/recalls/${r.id}`)
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <form onSubmit={submit} className="modal-box" style={{ width: '100%', maxWidth: 640, padding: 28, position: 'relative', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, maxHeight: '90vh', overflowY: 'auto' }}>
        <button type="button" onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}><X size={18} /></button>
        <div style={{ gridColumn: '1 / -1' }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 8 }}><Siren size={18} style={{ color: '#DC2626' }} /> {mock ? 'Start a mock recall (IBG-F10)' : 'Open a recall / FSCA'}</h3>
          <p style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>{mock
            ? 'Unannounced exercise: the batch gets a MOCK test hold, you trace, reconcile and contact a sample of consignees, then record the results. Nothing goes to customers.'
            : 'The batches are blocked at once (no sales, samples or shipments) and you get every customer / order that received them. The MD authorises the strategy (IBG-F04); HSA must be notified (MDRR1) before an FSCA starts in Singapore.'}</p>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={label}>Action</label>
          <select className="input-field" value={action} onChange={e => setAction(e.target.value as ActionType)}>
            {(Object.keys(ACTION_TYPES) as ActionType[]).map(k => <option key={k} value={k}>{ACTION_TYPES[k].label}</option>)}
          </select>
          <div style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>{ACTION_TYPES[action].hint}</div>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={label}>Product</label>
          <select className="input-field" value={productId} onChange={e => { setProductId(e.target.value); setPicked(new Set()) }}>
            <option value="">— Choose —</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` · ${p.sku}` : ''}</option>)}
          </select>
        </div>
        {productId && (
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={label}>Batches</label>
            <div style={{ border: '1px solid #E2E8F0', borderRadius: 10, padding: 6, maxHeight: 200, overflowY: 'auto' }}>
              {batches.length === 0 && <div style={{ fontSize: 12, color: '#94A3B8', padding: 6 }}>No batches recorded for this product.</div>}
              {batches.map(b => (
                <label key={key(b)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px', fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={picked.has(key(b))} onChange={e => setPicked(s => { const n = new Set(s); if (e.target.checked) n.add(key(b)); else n.delete(key(b)); return n })} />
                  <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{b.batch_number || '(no number)'}</span>
                  <span style={{ color: '#64748B' }}>{b.expiry_date ? `exp ${formatDate(b.expiry_date)}` : 'no expiry'}</span>
                  <span style={{ marginLeft: 'auto', color: '#64748B', fontSize: 12 }}>{b.on_hand} in stock · {-b.units_out} out</span>
                  {b.status && b.status !== 'released' && <span className={`badge ${BATCH_STATUS[b.status].badge}`} style={{ fontSize: 10 }}>{BATCH_STATUS[b.status].label}</span>}
                </label>
              ))}
            </div>
          </div>
        )}
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={label}>Title (optional)</label>
          <input className="input-field" placeholder="e.g. False positives — supplier notice 12 Oct" value={title} onChange={e => setTitle(e.target.value)} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={label}>Reason</label>
          <textarea className="input-field" rows={3} placeholder="What is wrong, and what customers should do" value={reason} onChange={e => setReason(e.target.value)} />
        </div>
        <div>
          <label style={label}>Where the notice came from</label>
          <select className="input-field" value={source} onChange={e => setSource(e.target.value as RecallSource)}>
            {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        {!mock && <>
          <div>
            <label style={label}>Severity (IBG-F03)</label>
            <select className="input-field" value={sev} onChange={e => setSev(e.target.value)}>
              <option value="">—</option>{SEVERITIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label style={label}>Probability</label>
            <select className="input-field" value={prob} onChange={e => setProb(e.target.value)}>
              <option value="">—</option>{PROBABILITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label style={label}>Risk level{suggested ? ` (matrix: ${TRIAGE[suggested].label})` : ''}</label>
            <select className="input-field" value={triage} onChange={e => setTriage(e.target.value as Triage | '')}>
              <option value="">{suggested ? `Use matrix — ${TRIAGE[suggested].label}` : '—'}</option>
              {(Object.keys(TRIAGE) as Triage[]).map(t => <option key={t} value={t}>{TRIAGE[t].label}</option>)}
            </select>
          </div>
          <div style={{ fontSize: 12, color: '#64748B', alignSelf: 'center' }}>{(triage || suggested) ? DECISION_RULE[(triage || suggested) as Triage] : 'The product owner’s Health Hazard Assessment prevails over this internal triage.'}</div>
          <label style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: '#991B1B', cursor: 'pointer' }}>
            <input type="checkbox" checked={immediate} onChange={e => setImmediate(e.target.checked)} />
            <span><b>Immediate safety containment</b> — activate the recall now without waiting for the MD (QRP alone; the MD still authorises the strategy afterwards).</span>
          </label>
        </>}
        {error && <div style={{ gridColumn: '1 / -1', padding: '10px 14px', background: '#FEE2E2', borderRadius: 10, fontSize: 12, color: '#991B1B', fontWeight: 600 }}>{error}</div>}
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
          <button type="button" className="btn-secondary btn-sm" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary btn-sm" style={{ flex: 1, justifyContent: 'center', background: '#DC2626', borderColor: '#DC2626' }} disabled={busy}>{busy ? 'Opening…' : mock ? 'Start mock recall' : 'Open & block stock'}</button>
        </div>
      </form>
    </div>
  )
}
