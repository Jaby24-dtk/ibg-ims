'use client'

import { useState } from 'react'
import { ShieldCheck, FileStack, History } from 'lucide-react'
import { PERIODS, type Period } from '@/lib/audit'
import AuditPack from '@/components/audit/AuditPack'
import AuditTrail from '@/components/audit/AuditTrail'

type Tab = 'pack' | 'trail'

export default function AuditPage() {
  const [tab, setTab] = useState<Tab>('pack')
  const [preset, setPreset] = useState('month')
  const [period, setPeriod] = useState<Period>(() => PERIODS[0].range())

  const pick = (id: string) => {
    setPreset(id)
    const p = PERIODS.find(x => x.id === id)
    if (p) setPeriod(p.range())
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 8 }}>
          <ShieldCheck size={22} style={{ color: '#2FA6B8' }} /> Audit &amp; Compliance
        </h1>
        <p style={{ color: '#64748B', fontSize: 14, marginTop: 2 }}>
          Everything an ISO auditor asks for, for any period — print it as a PDF pack or download it as Excel. The audit trail shows who changed what, and can&apos;t be edited or deleted.
        </p>
      </div>

      <div className="card" style={{ padding: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: 4 }}>Period</span>
        {PERIODS.map(p => (
          <button key={p.id} className={preset === p.id ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => pick(p.id)}>{p.label}</button>
        ))}
        <span style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto', fontSize: 13, color: '#64748B' }}>
          <input type="date" className="input-field" style={{ width: 150 }} value={period.from} max={period.to}
            onChange={e => { if (e.target.value) { setPreset('custom'); setPeriod(p => ({ ...p, from: e.target.value })) } }} />
          to
          <input type="date" className="input-field" style={{ width: 150 }} value={period.to} min={period.from}
            onChange={e => { if (e.target.value) { setPreset('custom'); setPeriod(p => ({ ...p, to: e.target.value })) } }} />
        </span>
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #E2E8F0' }}>
        {([['pack', 'Audit pack', FileStack], ['trail', 'Audit trail', History]] as const).map(([id, l, Icon]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 600, color: tab === id ? '#2FA6B8' : '#64748B',
            borderBottom: `2px solid ${tab === id ? '#2FA6B8' : 'transparent'}`, marginBottom: -1,
          }}><Icon size={15} /> {l}</button>
        ))}
      </div>

      {tab === 'pack' ? <AuditPack key={`${period.from}|${period.to}`} period={period} /> : <AuditTrail key={`${period.from}|${period.to}`} period={period} />}
    </div>
  )
}
