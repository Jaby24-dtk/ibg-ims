'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, Search, Archive, Inbox, ShoppingCart, FileText, Building2, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/context/AuthContext'
import { useRole, canExport } from '@/lib/use-role'
import { ACTIVE_DOC_TYPES, STATUS, docTypeLabel, formatAmount, outcomeLabel } from '@/lib/forms'
import { formatDate } from '@/lib/utils'
import type { CompanyProfile, DocType, FormDocument } from '@/types'
import { useApprovals } from '@/lib/approvals'
import { usePaged } from '@/components/ui/Pager'

type Tab = 'todo' | Exclude<DocType, 'invoice'> | 'archive'
type UserLite = { id: string; name: string; role: string }

const th: React.CSSProperties = { padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '12px 16px', fontSize: 13, color: '#374151' }
const label: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }

export default function FormsPage() {
  const router = useRouter()
  const role = useRole()
  const { profile, isMockMode } = useAuth()
  const me = profile?.id
  const approvals = useApprovals(role)
  // Approvers per form type come from Settings → Approvals.
  const approver = (d: FormDocument) => approvals.can(d.doc_type)
  const [docs, setDocs] = useState<FormDocument[] | null>(null)
  const [missing, setMissing] = useState(false)
  const [users, setUsers] = useState<UserLite[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [tab, setTab] = useState<Tab>('todo')
  const [search, setSearch] = useState('')
  const [company, setCompany] = useState<CompanyProfile | null>(null)
  const [companyOpen, setCompanyOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- no table in sample-data mode
    if (isMockMode) { setMissing(true); return }
    const sb = createClient()
    ;(async () => {
      const [docRes, userRes, supRes, custRes, compRes] = await Promise.all([
        sb.from('documents').select('*').order('updated_at', { ascending: false }).limit(1000),
        sb.from('users').select('id, name, role'),
        sb.from('suppliers').select('id, name'),
        sb.from('customers').select('id, name'),
        sb.from('company_profile').select('*').eq('id', 1).maybeSingle(),
      ])
      if (docRes.error) { setMissing(true); return }
      setDocs(docRes.data as FormDocument[])
      setUsers((userRes.data ?? []) as UserLite[])
      const n: Record<string, string> = {}
      for (const r of [...(supRes.data ?? []), ...(custRes.data ?? [])] as { id: string; name: string }[]) n[r.id] = r.name
      setNames(n)
      if (compRes.data) setCompany(compRes.data as CompanyProfile)
    })()
  }, [isMockMode])

  const userName = (id: string | null) => users.find(u => u.id === id)?.name ?? '—'
  const partyName = (d: FormDocument) =>
    (d.party?.name as string | undefined) ?? names[(d.doc_type === 'purchase_order' ? d.supplier_id : d.customer_id) ?? ''] ?? '—'

  const isTodo = (d: FormDocument) => !d.archived_at && (
    (d.assigned_to === me && d.status !== 'pending_approval')
    || (approver(d) && d.status === 'pending_approval' && d.prepared_by !== me)
    || (d.prepared_by === me && (d.status === 'draft' || d.status === 'rejected')))

  const counts = useMemo(() => {
    const list = docs ?? []
    return {
      todo: list.filter(isTodo).length,
      purchase_order: list.filter(d => d.doc_type === 'purchase_order' && !d.archived_at).length,
      quotation: list.filter(d => d.doc_type === 'quotation' && !d.archived_at).length,
      archive: list.filter(d => d.archived_at).length,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, me, approvals.rules, approvals.users, approvals.me, role])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (docs ?? []).filter(d => {
      const inTab = tab === 'todo' ? isTodo(d) : tab === 'archive' ? !!d.archived_at : d.doc_type === tab && !d.archived_at
      return inTab && (!q || d.doc_number.toLowerCase().includes(q) || partyName(d).toLowerCase().includes(q)
        || (d.reference ?? '').toLowerCase().includes(q))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, tab, search, me, approvals.rules, approvals.users, approvals.me, role, names])
  const { pageRows, pager } = usePaged(rows, `${tab}|${search}`)

  const todoReason = (d: FormDocument) => {
    if (approver(d) && d.status === 'pending_approval' && d.prepared_by !== me) return 'Needs your approval'
    if (d.status === 'rejected') return 'Rejected — fix and resubmit'
    if (d.status === 'draft') return 'Draft — submit when ready'
    if (d.assigned_to === me) return d.status === 'approved' ? 'Approved — go ahead' : 'You’re in charge'
    return ''
  }

  const saveCompany = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!company) return
    setSaving(true); setError('')
    const { error } = await createClient().from('company_profile').update({ ...company, gst_rate: Number(company.gst_rate) || 0 }).eq('id', 1)
    setSaving(false)
    if (error) { setError(error.message); return }
    setCompanyOpen(false)
  }

  const TABS: { id: Tab; label: string; icon: typeof Inbox }[] = [
    { id: 'todo', label: 'My to-do', icon: Inbox },
    { id: 'purchase_order', label: 'Purchase Orders', icon: ShoppingCart },
    { id: 'quotation', label: 'Quotations', icon: FileText },
    { id: 'archive', label: 'Archive', icon: Archive },
  ]
  const canCreate = canExport(role)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>Forms &amp; Approvals</h1>
          <p style={{ color: '#64748B', fontSize: 14, marginTop: 2 }}>Purchase orders and quotations — approved digitally, no printing or company chop. Finished forms are archived.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {role === 'administrator' && company && (
            <button className="btn-secondary btn-sm" onClick={() => setCompanyOpen(true)}><Building2 size={15} /> Company details</button>
          )}
          {canCreate && !missing && ACTIVE_DOC_TYPES.map(t => (
            <Link key={t.type} href={`/forms/new/${t.type}`} className={t.type === 'purchase_order' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} style={{ textDecoration: 'none' }}>
              <Plus size={15} /> {t.label}
            </Link>
          ))}
        </div>
      </div>

      {missing ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: '#64748B', fontSize: 13 }}>
          Forms need a one-time database update: run
          <code style={{ margin: '0 4px' }}>supabase/migrations/2026-10-22_iso-forms.sql</code>
          in the Supabase SQL editor.
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: 4, padding: '12px 16px 0', borderBottom: '1px solid #E2E8F0', flexWrap: 'wrap' }}>
            {TABS.map(({ id, label: l, icon: Icon }) => (
              <button key={id} onClick={() => setTab(id)} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', border: 'none', background: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 600, color: tab === id ? '#2FA6B8' : '#64748B',
                borderBottom: `2px solid ${tab === id ? '#2FA6B8' : 'transparent'}`, marginBottom: -1,
              }}>
                <Icon size={15} /> {l}
                <span className={`badge ${id === 'todo' && counts.todo ? 'badge-danger' : 'badge-gray'}`} style={{ fontSize: 11 }}>{counts[id]}</span>
              </button>
            ))}
          </div>
          <div style={{ padding: 16 }}>
            <div style={{ position: 'relative', maxWidth: 420 }}>
              <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
              <input className="input-field" style={{ paddingLeft: 36 }} placeholder="Search number, vendor / customer, reference…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderTop: '1px solid #E2E8F0', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                  {['Number', 'Type', 'Vendor / Customer', 'Total', 'Status', 'Person in charge', 'Prepared by', 'Updated'].map(c => <th key={c} style={th}>{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {docs === null && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: '#94A3B8', padding: 40 }}>Loading…</td></tr>}
                {docs && rows.length === 0 && (
                  <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: '#94A3B8', padding: 40 }}>
                    {tab === 'todo' ? 'Nothing waiting on you.' : tab === 'archive' ? 'No archived forms yet.' : 'No forms here yet.'}
                  </td></tr>
                )}
                {pageRows.map(d => (
                  <tr key={d.id} className="table-row-hover" style={{ borderBottom: '1px solid #F1F5F9', cursor: 'pointer' }} onClick={() => router.push(`/forms/${d.id}`)}>
                    <td style={{ ...td, fontFamily: 'monospace', fontWeight: 700, color: '#0F172A' }}>
                      {d.doc_number}
                      {tab === 'todo' && <div style={{ fontFamily: 'inherit', fontWeight: 500, fontSize: 11, color: '#B45309' }}>{todoReason(d)}</div>}
                    </td>
                    <td style={td}>{docTypeLabel(d.doc_type)}</td>
                    <td style={td}>{partyName(d)}</td>
                    <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>{formatAmount(Number(d.total), d.currency)}</td>
                    <td style={td}>
                      <span className={`badge ${STATUS[d.status].badge}`}>{STATUS[d.status].label}</span>
                      {d.outcome && <div style={{ fontSize: 11, color: '#64748B', marginTop: 3 }}>{outcomeLabel(d.doc_type, d.outcome)}</div>}
                    </td>
                    <td style={td}>{userName(d.assigned_to)}</td>
                    <td style={td}>{userName(d.prepared_by)}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap', color: '#64748B' }}>{formatDate(d.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pager}
        </div>
      )}

      {companyOpen && company && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setCompanyOpen(false) }}>
          <form onSubmit={saveCompany} className="modal-box" style={{ width: '100%', maxWidth: 600, padding: 28, position: 'relative', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <button type="button" onClick={() => setCompanyOpen(false)} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}><X size={18} /></button>
            <div style={{ gridColumn: '1 / -1' }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>Company details</h3>
              <p style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>Printed on every form, and the default bill-to / ship-to on purchase orders.</p>
            </div>
            {([
              ['name', 'Company name', false], ['registration_no', 'UEN / registration no.', false],
              ['gst_no', 'GST registration no.', false], ['gst_rate', 'GST rate (%)', false],
              ['phone', 'Phone', false], ['email', 'Email', false],
              ['address', 'Address', true], ['default_bill_to', 'Default bill to (POs)', true], ['default_ship_to', 'Default ship to / delivery address (POs)', true],
            ] as const).map(([k, l, area]) => (
              <div key={k} style={{ gridColumn: area ? '1 / -1' : undefined }}>
                <label style={label}>{l}</label>
                {area
                  ? <textarea className="input-field" rows={2} style={{ resize: 'vertical' }} value={String(company[k] ?? '')} onChange={e => setCompany(c => c && { ...c, [k]: e.target.value })} />
                  : <input className="input-field" type={k === 'gst_rate' ? 'number' : 'text'} value={String(company[k] ?? '')} onChange={e => setCompany(c => c && { ...c, [k]: e.target.value })} />}
              </div>
            ))}
            {error && <div style={{ gridColumn: '1 / -1', padding: '10px 14px', background: '#FEE2E2', borderRadius: 10, fontSize: 12, color: '#991B1B', fontWeight: 600 }}>{error}</div>}
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
              <button type="button" className="btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => setCompanyOpen(false)}>Cancel</button>
              <button type="submit" className="btn-primary btn-sm" style={{ flex: 1, justifyContent: 'center' }} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
