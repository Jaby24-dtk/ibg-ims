'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, Wrench } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { CAPA_SOURCES } from '@/lib/quality'

const label: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }

/** Open a CAPA (IBG-F08) — from a case, a recall, a mock recall, an audit finding or a trend. */
export default function CapaNew({ initial, onClose }: {
  initial?: { source?: string; caseId?: string; recallId?: string; title?: string; problem?: string }
  onClose: () => void
}) {
  const router = useRouter()
  const [users, setUsers] = useState<{ id: string; name: string }[]>([])
  const [f, setF] = useState({ title: initial?.title ?? '', source: initial?.source ?? 'complaint', owner_id: '', problem: initial?.problem ?? '', containment: '', linked_refs: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    createClient().from('users').select('id, name, role').neq('role', 'viewer').order('name').then(({ data }) => setUsers((data ?? []) as typeof users))
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!f.title.trim()) { setError('Give the CAPA a title.'); return }
    setBusy(true); setError('')
    const sb = createClient()
    const { data, error } = await sb.from('capas').insert({
      title: f.title.trim(), source: f.source, owner_id: f.owner_id || null, problem: f.problem || null, containment: f.containment || null,
      linked_refs: f.linked_refs || null, case_id: initial?.caseId ?? null, recall_id: initial?.recallId ?? null,
    }).select('id').single()
    if (!error && initial?.recallId) await sb.rpc('recall_update', { p_recall: initial.recallId, p_patch: { capa_id: data.id } })
    setBusy(false)
    if (error) { setError(/capas/.test(error.message) ? 'Needs the 2026-10-23_recall-sop.sql database update.' : error.message); return }
    fetch('/api/notifications/send', { method: 'POST' }).catch(() => {})
    router.push(`/traceability/capa/${data.id}`)
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <form onSubmit={submit} className="modal-box" style={{ width: '100%', maxWidth: 600, padding: 28, position: 'relative', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, maxHeight: '90vh', overflowY: 'auto' }}>
        <button type="button" onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}><X size={18} /></button>
        <div style={{ gridColumn: '1 / -1' }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 8 }}><Wrench size={18} style={{ color: '#0F766E' }} /> Open a CAPA (IBG-F08)</h3>
          <p style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>Required for every recall / FSCA and reportable adverse event, any Critical case, a Major case with a Germonizer-controlled cause, a trend, an audit or mock-recall finding, a missed deadline or a hold failure.</p>
        </div>
        <div style={{ gridColumn: '1 / -1' }}><label style={label}>Title</label><input className="input-field" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></div>
        <div><label style={label}>Source</label><select className="input-field" value={f.source} onChange={e => setF({ ...f, source: e.target.value })}>{CAPA_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
        <div><label style={label}>Owner</label><select className="input-field" value={f.owner_id} onChange={e => setF({ ...f, owner_id: e.target.value })}><option value="">— Choose —</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <div style={{ gridColumn: '1 / -1' }}><label style={label}>Problem statement (what, where, when, how many, which batches)</label><textarea className="input-field" rows={3} value={f.problem} onChange={e => setF({ ...f, problem: e.target.value })} /></div>
        <div style={{ gridColumn: '1 / -1' }}><label style={label}>Containment already taken</label><input className="input-field" placeholder="Hold, quarantine, customer advice…" value={f.containment} onChange={e => setF({ ...f, containment: e.target.value })} /></div>
        <div style={{ gridColumn: '1 / -1' }}><label style={label}>Other linked references</label><input className="input-field" placeholder="Audit finding no., supplier ref…" value={f.linked_refs} onChange={e => setF({ ...f, linked_refs: e.target.value })} /></div>
        {error && <div style={{ gridColumn: '1 / -1', padding: '10px 14px', background: '#FEE2E2', borderRadius: 10, fontSize: 12, color: '#991B1B', fontWeight: 600 }}>{error}</div>}
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
          <button type="button" className="btn-secondary btn-sm" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary btn-sm" style={{ flex: 1, justifyContent: 'center' }} disabled={busy}>{busy ? 'Opening…' : 'Open CAPA'}</button>
        </div>
      </form>
    </div>
  )
}
