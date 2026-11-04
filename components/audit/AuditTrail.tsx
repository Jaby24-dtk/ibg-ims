'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Search, FileSpreadsheet, Lock } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatDate } from '@/lib/utils'
import { AUDIT_ACTION, ENTITY_LABEL, bounds, changeSummary, loadEvents, type ChangeRow, type EventRow, type Period } from '@/lib/audit'
import { EVENT_LABEL as FORM_EVENT } from '@/lib/forms'
import { EVENT_LABEL as COUNT_EVENT } from '@/lib/counts'
import { RECALL_EVENT } from '@/lib/trace'
import { exportWorkbook } from '@/lib/sheet-io'
import { usePaged } from '@/components/ui/Pager'

const th: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '9px 14px', fontSize: 13, color: '#374151', verticalAlign: 'top' }
const when = (iso: string) => new Date(iso).toLocaleString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })

type Area = 'master' | 'accounts' | 'forms' | 'counts' | 'recalls'
const AREAS: { id: Area; label: string; badge: string }[] = [
  { id: 'master', label: 'Master data', badge: 'badge-gray' },
  { id: 'accounts', label: 'User accounts', badge: 'badge-danger' },
  { id: 'forms', label: 'Forms', badge: 'badge-info' },
  { id: 'counts', label: 'Cycle counts', badge: 'badge-warning' },
  { id: 'recalls', label: 'Recalls', badge: 'badge-purple' },
]
type Row = { id: string; at: string; who: string; area: Area; action: string; record: string; detail: string; href: string | null }

/** One timeline of who did what: master-data changes (audit_log) plus the form, count and recall histories. */
export default function AuditTrail({ period }: { period: Period }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [missing, setMissing] = useState<string[]>([])
  const [error, setError] = useState('')
  const [area, setArea] = useState<'' | Area>('')
  const [person, setPerson] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    const sb = createClient()
    let live = true
    ;(async () => {
      const { start, end } = bounds(period)
      const changes: ChangeRow[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from('audit_log').select('id, actor_name, actor_email, action, entity_type, entity_id, entity_label, snapshot, created_at')
          .gte('created_at', start).lte('created_at', end).order('created_at', { ascending: false }).range(from, from + 999)
        if (error) throw new Error(error.message)
        changes.push(...(data as ChangeRow[]))
        if (!data || data.length < 1000) break
      }
      const ev = await loadEvents(sb, period)
      // Record numbers for the events (they may belong to forms / counts / recalls from before the period).
      const names = async (table: string, col: string, ids: string[]) => {
        const m = new Map<string, string>()
        const uniq = [...new Set(ids)]
        for (let i = 0; i < uniq.length; i += 100) {
          const { data } = await sb.from(table).select(`id, ${col}`).in('id', uniq.slice(i, i + 100))
          for (const r of (data ?? []) as unknown as Record<string, string>[]) m.set(r.id, r[col])
        }
        return m
      }
      const [docN, countN, recallN] = await Promise.all([
        names('documents', 'doc_number', ev.forms.map(e => e.parent_id)),
        names('stock_counts', 'count_number', ev.counts.map(e => e.parent_id)),
        names('recalls', 'recall_number', ev.recalls.map(e => e.parent_id)),
      ])
      const fromEvents = (list: EventRow[], a: Area, labels: Record<string, string>, nums: Map<string, string>, base: string): Row[] =>
        list.map(e => ({ id: `${a}-${e.id}`, at: e.created_at, who: e.actor_name ?? 'System', area: a, action: labels[e.action] ?? e.action,
          record: nums.get(e.parent_id) ?? '(deleted)', detail: e.note ?? '', href: nums.has(e.parent_id) ? `${base}/${e.parent_id}` : null }))
      const all: Row[] = [
        ...changes.map(c => ({
          id: `log-${c.id}`, at: c.created_at, who: c.actor_name ?? c.actor_email ?? 'System',
          area: (c.entity_type === 'user_account' ? 'accounts' : 'master') as Area,
          action: `${AUDIT_ACTION[c.action] ?? c.action} ${(ENTITY_LABEL[c.entity_type] ?? c.entity_type).toLowerCase()}`,
          record: c.entity_label ?? '', detail: changeSummary(c), href: null,
        })),
        ...fromEvents(ev.forms, 'forms', FORM_EVENT, docN, '/forms'),
        ...fromEvents(ev.counts, 'counts', COUNT_EVENT, countN, '/cycle-counts'),
        ...fromEvents(ev.recalls, 'recalls', RECALL_EVENT, recallN, '/traceability/recalls'),
      ].sort((a, b) => b.at.localeCompare(a.at))
      if (live) { setRows(all); setMissing(ev.missing) }
    })().catch(e => { if (live) setError((e as Error).message) })
    return () => { live = false }
  }, [period])

  const people = useMemo(() => [...new Set((rows ?? []).map(r => r.who))].sort((a, b) => a.localeCompare(b)), [rows])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows ?? []).filter(r => (!area || r.area === area) && (!person || r.who === person)
      && (!q || `${r.action} ${r.record} ${r.detail}`.toLowerCase().includes(q)))
  }, [rows, area, person, search])
  const { pageRows, pager } = usePaged(filtered, `${area}|${person}|${search}`)

  const excel = () => exportWorkbook(`audit-trail-${period.from}-to-${period.to}`, [{
    name: 'Audit trail', columns: ['Date', 'By', 'Area', 'Action', 'Record', 'Details'],
    rows: filtered.map(r => [when(r.at), r.who, AREAS.find(a => a.id === r.area)!.label, r.action, r.record, r.detail]),
  }])

  if (error) return <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#FEE2E2', border: '1px solid #FECACA', color: '#991B1B' }}>{error}</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 240px' }}>
          <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
          <input className="input-field" style={{ paddingLeft: 36 }} placeholder="Search action, record or detail" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input-field" style={{ width: 170 }} value={area} onChange={e => setArea(e.target.value as '' | Area)}>
          <option value="">All areas</option>
          {AREAS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
        <select className="input-field" style={{ width: 170 }} value={person} onChange={e => setPerson(e.target.value)}>
          <option value="">Everyone</option>
          {people.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <button className="btn-secondary btn-sm" onClick={excel} disabled={!filtered.length}><FileSpreadsheet size={15} /> Excel</button>
      </div>
      <div style={{ fontSize: 12, color: '#64748B', display: 'flex', gap: 6, alignItems: 'center' }}>
        <Lock size={13} /> {formatDate(period.from)} – {formatDate(period.to)} · {rows ? `${filtered.length} entr${filtered.length === 1 ? 'y' : 'ies'}` : 'loading…'} · entries are permanent — nobody can edit or delete them.
        {missing.length > 0 && <span style={{ color: '#92400E' }}> Not set up yet: {missing.join(', ')}.</span>}
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
              {['When', 'Who', 'Area', 'What', 'Record', 'Details'].map(c => <th key={c} style={th}>{c}</th>)}
            </tr></thead>
            <tbody>
              {rows === null && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#94A3B8', padding: 40 }}>Loading…</td></tr>}
              {rows && filtered.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#94A3B8', padding: 40 }}>Nothing recorded for these filters.</td></tr>}
              {pageRows.map(r => {
                const a = AREAS.find(x => x.id === r.area)!
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ ...td, whiteSpace: 'nowrap', color: '#64748B' }}>{when(r.at)}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap', fontWeight: 600 }}>{r.who}</td>
                    <td style={td}><span className={`badge ${a.badge}`}>{a.label}</span></td>
                    <td style={td}>{r.action}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{r.href ? <Link href={r.href}>{r.record}</Link> : r.record}</td>
                    <td style={{ ...td, color: '#64748B', maxWidth: 420, wordBreak: 'break-word' }}>{r.detail}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {pager}
      </div>
    </div>
  )
}
