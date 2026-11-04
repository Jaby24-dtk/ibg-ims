'use client'

import { useEffect, useState } from 'react'
import { X, PauseCircle, ClipboardCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatDate } from '@/lib/utils'
import { DISPOSITIONS, HOLD_CODES, type DispositionKind, type HoldCode } from '@/lib/quality'

const label: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }
const hint: React.CSSProperties = { fontSize: 12, color: '#64748B', marginTop: 4 }

export interface BatchRef { productId: string; productName: string; batchNumber: string; expiry: string | null; batchId: string; onHand: number }

function Shell({ title, icon, children, onClose }: { title: string; icon: React.ReactNode; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-box" style={{ width: '100%', maxWidth: 560, padding: 26, position: 'relative', display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '90vh', overflowY: 'auto' }}>
        <button type="button" onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}><X size={18} /></button>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 8 }}>{icon} {title}</h3>
        {children}
      </div>
    </div>
  )
}

const batchText = (b: BatchRef) => `${b.productName} · ${b.batchNumber || '(no batch no.)'}${b.expiry ? ` · exp ${formatDate(b.expiry)}` : ''}`

/** "Put on hold" (SOP B2) — any staff member. The whole batch is held at every site. */
export function HoldDialog({ batch, onClose, onDone }: { batch: BatchRef; onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState<HoldCode>('COMPLAINT')
  const [reason, setReason] = useState('')
  const [caseId, setCaseId] = useState('')
  const [cases, setCases] = useState<{ id: string; case_number: string; description: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    createClient().from('quality_cases').select('id, case_number, description').eq('status', 'open').eq('product_id', batch.productId)
      .order('received_at', { ascending: false }).then(({ data }) => setCases((data ?? []) as typeof cases))
  }, [batch.productId])

  const submit = async () => {
    if (!reason.trim()) { setError('Give the reason.'); return }
    setBusy(true); setError('')
    const { error } = await createClient().rpc('batch_hold', { p_batch: batch.batchId, p_code: code, p_reason: reason, p_case: caseId || null })
    setBusy(false)
    if (error) { setError(error.message); return }
    fetch('/api/notifications/send', { method: 'POST' }).catch(() => {})
    onDone()
  }

  return (
    <Shell title="Put on hold" icon={<PauseCircle size={18} style={{ color: '#D97706' }} />} onClose={onClose}>
      <div style={{ fontSize: 13, color: '#374151' }}>{batchText(batch)} — <b>{batch.onHand}</b> in stock. Nothing can be sold, sampled or shipped from it until the QRP decides a disposition.</div>
      <div>
        <label style={label}>Reason code</label>
        <select className="input-field" value={code} onChange={e => setCode(e.target.value as HoldCode)}>
          {HOLD_CODES.map(h => <option key={h.code} value={h.code}>{h.code} — {h.label}</option>)}
        </select>
      </div>
      <div>
        <label style={label}>What happened</label>
        <textarea className="input-field" rows={3} autoFocus placeholder="e.g. 3 units with cracked housing found at picking; customer reports readings 2 °C low" value={reason} onChange={e => setReason(e.target.value)} />
      </div>
      <div>
        <label style={label}>Linked case (IBG-F01)</label>
        <select className="input-field" value={caseId} onChange={e => setCaseId(e.target.value)}>
          <option value="">— None —</option>
          {cases.map(c => <option key={c.id} value={c.id}>{c.case_number} — {c.description.slice(0, 60)}</option>)}
        </select>
      </div>
      <div style={{ fontSize: 12, color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 10px' }}>
        Also move the units to the QUARANTINE area with a red “DO NOT USE / DO NOT SELL / UNDER INVESTIGATION” label (case ID, date, initials) and photograph them.
      </div>
      {error && <div style={{ padding: '10px 14px', background: '#FEE2E2', borderRadius: 10, fontSize: 12, color: '#991B1B', fontWeight: 600 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-secondary btn-sm" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
        <button className="btn-primary btn-sm" style={{ flex: 1, justifyContent: 'center', background: '#D97706', borderColor: '#D97706' }} disabled={busy} onClick={submit}>{busy ? 'Holding…' : 'Put on hold'}</button>
      </div>
    </Shell>
  )
}

/** Disposition (IBG-F11) — QRP. Release, return to supplier, destruction (Finance approves), replacement / refund, correction. */
export function DispositionDialog({ batch, blocked, recallId, caseId, onClose, onDone }: {
  batch: BatchRef; blocked: boolean; recallId?: string | null; caseId?: string | null; onClose: () => void; onDone: () => void
}) {
  const [kind, setKind] = useState<DispositionKind>(blocked ? 'release' : 'replacement_refund')
  const [qty, setQty] = useState(String(batch.onHand))
  const [rationale, setRationale] = useState('')
  const [evidence, setEvidence] = useState('')
  const [site, setSite] = useState('')
  const [sites, setSites] = useState<{ id: string; name: string; quantity: number }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    createClient().from('product_stock').select('location_id, quantity, stock_locations(name)').eq('product_id', batch.productId)
      .then(({ data }) => setSites(((data ?? []) as unknown as { location_id: string; quantity: number; stock_locations: { name: string } | null }[])
        .map(s => ({ id: s.location_id, name: s.stock_locations?.name ?? 'Site', quantity: s.quantity }))))
  }, [batch.productId])
  const writeOff = kind === 'return_to_supplier' || kind === 'destruction'
  const kinds = (Object.keys(DISPOSITIONS) as DispositionKind[]).filter(k => blocked || !['release', 'return_to_supplier', 'destruction'].includes(k))

  const submit = async () => {
    if (!rationale.trim()) { setError('Give the rationale / inspection result.'); return }
    if (kind === 'release' && !confirm('Release this batch back to saleable stock?')) return
    setBusy(true); setError('')
    const { error } = await createClient().rpc('disposition_record', {
      p_product: batch.productId, p_batch_number: batch.batchNumber, p_expiry: batch.expiry, p_kind: kind,
      p_qty: writeOff ? parseInt(qty, 10) || 0 : null, p_rationale: rationale, p_evidence: evidence || null,
      p_case: caseId ?? null, p_recall: recallId ?? null, p_location: writeOff && site ? site : null,
    })
    setBusy(false)
    if (error) { setError(error.message); return }
    fetch('/api/notifications/send', { method: 'POST' }).catch(() => {})
    onDone()
  }

  return (
    <Shell title="Disposition (IBG-F11)" icon={<ClipboardCheck size={18} style={{ color: '#0F766E' }} />} onClose={onClose}>
      <div style={{ fontSize: 13, color: '#374151' }}>{batchText(batch)} — <b>{batch.onHand}</b> in stock{blocked ? ' (blocked)' : ''}.</div>
      <div>
        <label style={label}>Decision</label>
        <select className="input-field" value={kind} onChange={e => setKind(e.target.value as DispositionKind)}>
          {kinds.map(k => <option key={k} value={k}>{DISPOSITIONS[k].label}</option>)}
        </select>
        <div style={hint}>{DISPOSITIONS[kind].hint}</div>
      </div>
      {writeOff && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '0 0 120px' }}>
            <label style={label}>Units</label>
            <input className="input-field" type="number" min={1} max={batch.onHand} value={qty} onChange={e => setQty(e.target.value)} />
          </div>
          {sites.length > 0 && (
            <div style={{ flex: 1 }}>
              <label style={label}>From site</label>
              <select className="input-field" value={site} onChange={e => setSite(e.target.value)}>
                <option value="">— Choose —</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name} ({s.quantity})</option>)}
              </select>
            </div>
          )}
        </div>
      )}
      <div>
        <label style={label}>Rationale / inspection or test result</label>
        <textarea className="input-field" rows={3} placeholder={kind === 'release' ? 'e.g. 5 units checked against reference thermometer per product owner method — within ±0.2 °C; cartons intact' : 'Why this disposition'} value={rationale} onChange={e => setRationale(e.target.value)} />
      </div>
      <div>
        <label style={label}>{kind === 'correction' ? 'Product owner’s written authorisation (reference)' : kind === 'destruction' ? 'Destruction certificate / vendor (can be added later)' : kind === 'return_to_supplier' ? 'Return authorisation no. / shipping document' : kind === 'replacement_refund' ? 'Credit note / replacement dispatch ref' : 'Evidence reference (optional)'}</label>
        <input className="input-field" value={evidence} onChange={e => setEvidence(e.target.value)} />
      </div>
      {writeOff && <div style={hint}>The write-off goes to Finance for approval; the units leave stock only when Finance approves.</div>}
      {error && <div style={{ padding: '10px 14px', background: '#FEE2E2', borderRadius: 10, fontSize: 12, color: '#991B1B', fontWeight: 600 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-secondary btn-sm" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
        <button className="btn-primary btn-sm" style={{ flex: 1, justifyContent: 'center' }} disabled={busy} onClick={submit}>{busy ? 'Saving…' : writeOff ? 'Send to Finance' : 'Record disposition'}</button>
      </div>
    </Shell>
  )
}
