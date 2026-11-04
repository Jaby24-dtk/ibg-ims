'use client'

import { useState } from 'react'
import { Check, Save, Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRole } from '@/lib/use-role'
import { APPROVAL_TYPES, useApprovals, type ApprovalType } from '@/lib/approvals'
import { ROLE_LABEL } from '@/lib/audit'

/** Settings → Approvals: an Administrator picks who approves each kind of record. */
export default function ApprovalsPanel() {
  const role = useRole()
  const admin = role === 'administrator'
  const { rules, users, missing, approvers, reload } = useApprovals(role)
  const [draft, setDraft] = useState<Partial<Record<ApprovalType, string[]>>>({})
  const [busy, setBusy] = useState<ApprovalType | null>(null)
  const [saved, setSaved] = useState<ApprovalType | null>(null)
  const [error, setError] = useState('')
  const eligible = users.filter(u => u.role !== 'viewer')
  const chosenOf = (t: ApprovalType) => draft[t] ?? rules.find(r => r.approval_type === t)?.approver_ids ?? []
  const dirty = (t: ApprovalType) => draft[t] !== undefined
    && JSON.stringify([...draft[t]!].sort()) !== JSON.stringify([...(rules.find(r => r.approval_type === t)?.approver_ids ?? [])].sort())

  const toggle = (t: ApprovalType, id: string) => {
    const cur = chosenOf(t)
    setDraft(d => ({ ...d, [t]: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] }))
    setSaved(null)
  }
  const save = async (t: ApprovalType) => {
    setBusy(t); setError('')
    const { error } = await createClient().from('approval_rules')
      .upsert({ approval_type: t, approver_ids: chosenOf(t), updated_at: new Date().toISOString() }, { onConflict: 'approval_type' })
    setBusy(null)
    if (error) { setError(error.message); return }
    await reload()
    setDraft(d => { const n = { ...d }; delete n[t]; return n })
    setSaved(t)
  }

  return (
    <div className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ paddingBottom: 12, borderBottom: '1px solid #F1F5F9' }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>Approvals</h3>
        <p style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>
          Choose who approves each kind of record. Only the people ticked can approve it, and only they get the “approval needed” alerts.
          Leave everyone unticked to use the default: every Administrator and Inventory Manager.
          Nobody can approve a form they prepared or a count they counted on. Every change here is recorded in the audit trail.
        </p>
      </div>
      {missing && (
        <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E' }}>
          Run the database update <code>2026-10-23_approval-matrix.sql</code> in Supabase to turn this on.
        </div>
      )}
      {!admin && <div style={{ fontSize: 13, color: '#64748B' }}>Only an Administrator can change approvers.</div>}
      {error && <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#FEE2E2', border: '1px solid #FECACA', color: '#991B1B' }}>{error}</div>}

      {APPROVAL_TYPES.map(({ type, label, hint }) => {
        const chosen = chosenOf(type)
        const now = approvers(type)
        return (
          <div key={type} style={{ border: '1px solid #E2E8F0', borderRadius: 12, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>{label}</div>
                <div style={{ fontSize: 12.5, color: '#64748B', marginTop: 2 }}>{hint}</div>
              </div>
              <div style={{ fontSize: 12, color: '#64748B', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Users size={14} />
                {now.custom ? <span>Approved by <b style={{ color: '#0F172A' }}>{now.users.map(u => u.name).join(', ')}</b></span>
                  : <span>Default — all Administrators &amp; Inventory Managers ({now.users.map(u => u.name).join(', ') || 'none'})</span>}
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              {eligible.map(u => {
                const on = chosen.includes(u.id)
                return (
                  <label key={u.id} style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, fontSize: 13, cursor: admin ? 'pointer' : 'default',
                    border: `1px solid ${on ? '#2FA6B8' : '#E2E8F0'}`, background: on ? '#E0F7FA' : '#fff',
                  }}>
                    <input type="checkbox" checked={on} disabled={!admin || missing} onChange={() => toggle(type, u.id)} />
                    <span style={{ fontWeight: 600, color: '#0F172A' }}>{u.name}</span>
                    <span style={{ color: '#94A3B8', fontSize: 11 }}>{ROLE_LABEL[u.role] ?? u.role}</span>
                  </label>
                )
              })}
            </div>
            {admin && (dirty(type) || saved === type) && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
                {dirty(type) ? <>
                  <button className="btn-primary btn-sm" disabled={busy === type} onClick={() => save(type)}><Save size={14} /> {busy === type ? 'Saving…' : 'Save'}</button>
                  <button className="btn-secondary btn-sm" onClick={() => setDraft(d => { const n = { ...d }; delete n[type]; return n })}>Undo</button>
                  {chosen.length === 0 && <span style={{ fontSize: 12, color: '#64748B' }}>Nobody ticked — goes back to the default.</span>}
                  {chosen.length === 1 && <span style={{ fontSize: 12, color: '#B45309' }}>Only one approver: they can&apos;t approve their own {type === 'cycle_count' ? 'counts' : 'forms'}, so add a backup.</span>}
                </> : <span style={{ fontSize: 12, color: '#15803D', display: 'flex', gap: 4, alignItems: 'center' }}><Check size={14} /> Saved</span>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
