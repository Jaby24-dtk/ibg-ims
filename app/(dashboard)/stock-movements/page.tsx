'use client'

import { useState } from 'react'
import { ArrowLeftRight, ArrowDown, ArrowUp, SlidersHorizontal, Scan, Search, X, FileText } from 'lucide-react'
import { mockTransactions, mockProducts, mockUsers } from '@/lib/mock-data'
import { formatDateTime } from '@/lib/utils'
import { useRole, canExport } from '@/lib/use-role'

const typeConfig: Record<string, { label: string; badge: string; icon: React.ElementType; color: string }> = {
  inbound:                { label: 'Receive', badge: 'badge-success', icon: ArrowDown, color: '#22C55E' },
  outbound:               { label: 'Outbound', badge: 'badge-info', icon: ArrowUp, color: '#38BDF8' },
  adjustment:             { label: 'Adjustment', badge: 'badge-warning', icon: SlidersHorizontal, color: '#F59E0B' },
  barcode_scan:           { label: 'Barcode Scan', badge: 'badge-purple', icon: Scan, color: '#7C3AED' },
  purchase_order_received:{ label: 'PO Received', badge: 'badge-success', icon: ArrowDown, color: '#22C55E' },
}

export default function StockMovementsPage() {
  const role = useRole()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('All')

  const transactions = mockTransactions.map(tx => ({
    ...tx,
    product: mockProducts.find(p => p.id === tx.product_id),
    user: mockUsers.find(u => u.id === tx.user_id),
  }))

  const filtered = transactions.filter(tx => {
    const q = search.toLowerCase()
    const matchSearch = !q
      || (tx.product?.name ?? '').toLowerCase().includes(q)
      || tx.sku.toLowerCase().includes(q)
      || tx.barcode.includes(q)
    const matchType = typeFilter === 'All' || tx.type === typeFilter
    return matchSearch && matchType
  })

  const summary = {
    inbound: transactions.filter(t => t.type === 'inbound' || t.type === 'purchase_order_received').reduce((s, t) => s + t.quantity, 0),
    outbound: transactions.filter(t => t.type === 'outbound').reduce((s, t) => s + Math.abs(t.quantity), 0),
    adjustments: transactions.filter(t => t.type === 'adjustment').length,
    scans: transactions.filter(t => t.type === 'barcode_scan').length,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>Stock Movements</h1>
          <p style={{ color: '#64748B', fontSize: 14, marginTop: 2 }}>All inventory movement records in one place.</p>
        </div>
        {canExport(role) && (
          <button
            className="btn-secondary btn-sm"
            onClick={() => {
              const rows = [
                ['Date & Time', 'Product', 'SKU', 'Barcode', 'Movement Type', 'Quantity', 'User', 'Notes'],
                ...filtered.map(tx => [
                  tx.created_at,
                  tx.product?.name ?? '',
                  tx.sku,
                  tx.barcode,
                  tx.type,
                  String(tx.quantity),
                  tx.user?.name ?? '',
                  tx.notes ?? '',
                ])
              ]
              const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
              const blob = new Blob([csv], { type: 'text/csv' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a'); a.href = url; a.download = `ibg-stock-movements-${new Date().toISOString().slice(0,10)}.csv`; a.click()
              URL.revokeObjectURL(url)
            }}
          >
            <FileText size={14} /> Export CSV
          </button>
        )}
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        {[
          { label: 'Inbound Stock', value: summary.inbound, color: '#22C55E', bg: '#DCFCE7', icon: ArrowDown },
          { label: 'Outbound Stock', value: summary.outbound, color: '#38BDF8', bg: '#E0F2FE', icon: ArrowUp },
          { label: 'Adjustments', value: summary.adjustments, color: '#F59E0B', bg: '#FEF3C7', icon: SlidersHorizontal },
          { label: 'Barcode Scans', value: summary.scans, color: '#7C3AED', bg: '#EDE9FE', icon: Scan },
        ].map(({ label, value, color, bg, icon: Icon }) => (
          <div key={label} className="card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Icon size={20} style={{ color }} />
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#0F172A' }}>{value.toLocaleString()}</div>
              <div style={{ fontSize: 12, color: '#64748B', fontWeight: 500 }}>{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 340 }}>
            <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
            <input className="input-field" style={{ paddingLeft: 36 }} placeholder="Search product, SKU, barcode..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="input-field" style={{ width: 200 }} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="All">All Movement Types</option>
            <option value="inbound">Inbound (Receive)</option>
            <option value="outbound">Outbound</option>
            <option value="adjustment">Adjustment</option>
            <option value="barcode_scan">Barcode Scan</option>
            <option value="purchase_order_received">PO Received</option>
          </select>
          {(search || typeFilter !== 'All') && (
            <button className="btn-secondary btn-sm" onClick={() => { setSearch(''); setTypeFilter('All') }}>
              <X size={14} /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                {['Date & Time', 'Product', 'SKU', 'Barcode', 'Movement Type', 'Quantity', 'User', 'Notes'].map(col => (
                  <th key={col} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((tx, i) => {
                const cfg = typeConfig[tx.type] ?? { label: tx.type, badge: 'badge-gray', icon: ArrowLeftRight, color: '#64748B' }
                const Icon = cfg.icon
                return (
                  <tr key={tx.id} className="table-row-hover" style={{ borderBottom: i < filtered.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: '#374151', whiteSpace: 'nowrap' }}>
                      {formatDateTime(tx.created_at)}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', whiteSpace: 'nowrap' }}>
                        {tx.product?.name ?? '—'}
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: 12, color: '#475569' }}>{tx.sku}</td>
                    <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: 12, color: '#94A3B8' }}>{tx.barcode}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Icon size={13} style={{ color: cfg.color }} />
                        <span className={`badge ${cfg.badge}`}>{cfg.label}</span>
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        fontSize: 14, fontWeight: 700,
                        color: tx.type === 'outbound' ? '#EF4444' : tx.quantity < 0 ? '#EF4444' : '#22C55E',
                      }}>
                        {tx.quantity > 0 && tx.type !== 'outbound' ? '+' : ''}{tx.quantity}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: '#374151', whiteSpace: 'nowrap' }}>
                      {tx.user?.name ?? '—'}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: '#64748B', maxWidth: 180 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.notes ?? '—'}</div>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>
                    <ArrowLeftRight size={32} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                    <div style={{ fontSize: 14 }}>No movements match your filters.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
