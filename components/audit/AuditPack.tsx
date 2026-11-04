'use client'

import { useEffect, useMemo, useState } from 'react'
import { Printer, FileSpreadsheet, AlertTriangle, AlertCircle, Info, ChevronDown, ChevronRight, CheckCircle2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/context/AuthContext'
import { formatDate } from '@/lib/utils'
import { loadAuditData, type AuditData, type Period } from '@/lib/audit'
import { exportWorkbook } from '@/lib/sheet-io'
import { buildPack } from '@/components/audit/pack'
import { printReport, type ReportSection } from '@/components/trace/print'
import { usePaged } from '@/components/ui/Pager'
import type { CompanyProfile } from '@/types'

const th: React.CSSProperties = { padding: '9px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '8px 12px', fontSize: 12.5, color: '#374151', verticalAlign: 'top' }
const LEVEL = {
  high: { icon: AlertTriangle, color: '#DC2626', bg: '#FEF2F2', label: 'High' },
  medium: { icon: AlertCircle, color: '#D97706', bg: '#FFFBEB', label: 'Medium' },
  info: { icon: Info, color: '#0369A1', bg: '#F0F9FF', label: 'Note' },
}

export default function AuditPack({ period }: { period: Period }) {
  const { profile } = useAuth()
  const [data, setData] = useState<AuditData | null>(null)
  const [company, setCompany] = useState<CompanyProfile | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    const sb = createClient()
    let live = true
    Promise.all([loadAuditData(sb, period), sb.from('company_profile').select('*').eq('id', 1).maybeSingle()])
      .then(([d, c]) => { if (!live) return; setData(d); if (c.data) setCompany(c.data as CompanyProfile) })
      .catch(e => { if (live) setError((e as Error).message) })
    return () => { live = false }
  }, [period])

  const pack = useMemo(() => data ? buildPack(data) : null, [data])
  const range = `${formatDate(period.from)} – ${formatDate(period.to)}`
  const me = (profile as { name?: string } | null)?.name ?? ''

  if (error) return <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#FEE2E2', border: '1px solid #FECACA', color: '#991B1B' }}>{error}</div>
  if (!data || !pack) return <div className="card" style={{ padding: 40, textAlign: 'center', color: '#94A3B8' }}>Gathering records for {range}…</div>
  const s = pack.summary

  const print = () => printReport({
    company, heading: 'ISO audit pack', number: `${period.from} to ${period.to}`, subtitle: 'Inventory management records',
    facts: [
      { label: 'Period', value: range },
      { label: 'Stock movements', value: String(data.transactions.length) },
      { label: 'Inventory accuracy', value: s.accuracy === null ? 'No approved counts' : `${s.accuracy}%` },
      { label: 'Forms', value: String(data.docs.length) },
      { label: 'Recalls', value: `${data.recalls.length} (${s.openRecalls.length} open)` },
      { label: 'Findings', value: `${s.findings.filter(f => f.level === 'high').length} high · ${s.findings.filter(f => f.level === 'medium').length} medium` },
    ],
    sections: pack.sections,
    signoff: [{ label: 'Prepared by', name: me, when: new Date().toISOString() }],
  })
  const excel = () => exportWorkbook(`audit-pack-${period.from}-to-${period.to}`, pack.sections.map(x => ({ name: x.sheet, columns: x.columns, rows: x.rows })))

  const tiles = [
    { l: 'Stock movements', v: data.transactions.length, sub: `${s.adjustments.length} adjustment(s)` },
    { l: 'Inventory accuracy', v: s.accuracy === null ? '—' : `${s.accuracy}%`, sub: `${s.approvedCounts.length} count(s) approved` },
    { l: 'Forms', v: data.docs.length, sub: `${s.pendingLong.length} waiting > 7 days` },
    { l: 'Recalls', v: data.recalls.length, sub: `${s.openRecalls.length} open` },
    { l: 'Expired / blocked', v: s.expired.length + s.blocked.filter(b => !s.expired.includes(b)).length, sub: 'batches in stock' },
    { l: 'Supplier evaluations due', v: s.evaluationDue.length, sub: `of ${s.goods.length} supplier(s)` },
    { l: 'Changes logged', v: data.changes.length, sub: 'master data & accounts' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: '#64748B' }}>Audit pack for <b style={{ color: '#0F172A' }}>{range}</b> · 12 sections</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary btn-sm" onClick={excel}><FileSpreadsheet size={15} /> Download Excel</button>
          <button className="btn-primary btn-sm" onClick={print}><Printer size={15} /> Print / save PDF</button>
        </div>
      </div>
      {data.missing.length > 0 && (
        <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E' }}>
          Some records aren&apos;t set up yet ({data.missing.join(', ')}) — those sections will be empty until the matching database update is run.
        </div>
      )}

      <div className="card" style={{ padding: 18, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }}>
        {tiles.map(t => (
          <div key={t.l}>
            <div style={{ fontSize: 11, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{t.l}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', marginTop: 2 }}>{t.v}</div>
            <div style={{ fontSize: 12, color: '#64748B' }}>{t.sub}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginBottom: 10 }}>Findings — what to fix before the audit</h3>
        {s.findings.length === 0 && <div style={{ fontSize: 13, color: '#15803D', display: 'flex', gap: 6, alignItems: 'center' }}><CheckCircle2 size={16} /> Nothing flagged for this period.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {s.findings.map(f => {
            const L = LEVEL[f.level]
            return (
              <div key={f.text} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px', borderRadius: 8, background: L.bg, fontSize: 13, color: '#0F172A' }}>
                <L.icon size={15} style={{ color: L.color, flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: L.color, width: 56 }}>{L.label}</span>
                {f.text}
              </div>
            )
          })}
        </div>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        {pack.sections.map(sec => (
          <div key={sec.title} style={{ borderBottom: '1px solid #F1F5F9' }}>
            <button onClick={() => setOpen(o => o === sec.title ? null : sec.title)} style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
            }}>
              {open === sec.title ? <ChevronDown size={16} style={{ color: '#64748B' }} /> : <ChevronRight size={16} style={{ color: '#64748B' }} />}
              <span style={{ fontSize: 13.5, fontWeight: 600, color: '#0F172A', flex: 1 }}>{sec.title}</span>
              <span className={`badge ${sec.rows.length ? 'badge-info' : 'badge-gray'}`}>{sec.rows.length} row{sec.rows.length === 1 ? '' : 's'}</span>
            </button>
            {open === sec.title && <SectionTable section={sec} />}
          </div>
        ))}
      </div>
    </div>
  )
}

function SectionTable({ section }: { section: ReportSection }) {
  const { pageRows, pager } = usePaged(section.rows, section.title, 25, false)
  return (
    <div style={{ borderTop: '1px solid #F1F5F9' }}>
      {section.note && <p style={{ padding: '10px 16px 0', fontSize: 12.5, color: '#64748B' }}>{section.note}</p>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>{section.columns.map(c => <th key={c} style={th}>{c}</th>)}</tr></thead>
          <tbody>
            {section.rows.length === 0 && <tr><td colSpan={section.columns.length} style={{ ...td, color: '#94A3B8', padding: 16 }}>{section.empty ?? 'None'}</td></tr>}
            {pageRows.map((r, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>{r.map((c, j) => <td key={j} style={td}>{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {pager}
    </div>
  )
}
