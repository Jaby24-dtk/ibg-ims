'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  Package, TrendingUp, AlertTriangle, DollarSign,
  ChevronRight, ArrowUpRight, ArrowDownRight, Clock,
} from 'lucide-react'
import { PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Legend } from 'recharts'
import { mockProducts, mockTransactions, mockAlerts } from '@/lib/mock-data'
import { getStockStatus, getExpiryStatus } from '@/types'
import { formatCurrency, formatDate, formatDateTime, daysUntil } from '@/lib/utils'

const COLORS = { Medical: '#2FA6B8', Detection: '#38BDF8' }
const STATUS_COLORS = { 'In Stock': '#22C55E', 'Low Stock': '#F59E0B', 'Out of Stock': '#EF4444' }

export default function DashboardPage() {
  const router = useRouter()
  const kpis = useMemo(() => {
    const totalSKUs = mockProducts.length
    const totalUnits = mockProducts.reduce((s, p) => s + p.stock_quantity, 0)
    const lowOrOut = mockProducts.filter(p => {
      const s = getStockStatus(p)
      return s === 'Low Stock' || s === 'Out of Stock'
    }).length
    const totalValue = mockProducts.reduce((s, p) => s + p.stock_quantity * p.unit_cost, 0)
    return { totalSKUs, totalUnits, lowOrOut, totalValue }
  }, [])

  const categoryData = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const p of mockProducts) counts[p.category] = (counts[p.category] ?? 0) + 1
    return Object.entries(counts).map(([name, value]) => ({ name, value }))
  }, [])

  const statusData = useMemo(() => {
    const counts: Record<string, number> = { 'In Stock': 0, 'Low Stock': 0, 'Out of Stock': 0 }
    for (const p of mockProducts) counts[getStockStatus(p)]++
    return Object.entries(counts).map(([name, value]) => ({ name, value }))
  }, [])

  const lowStockProducts = useMemo(() =>
    mockProducts.filter(p => {
      const s = getStockStatus(p)
      return s === 'Low Stock' || s === 'Out of Stock'
    }).slice(0, 6),
    []
  )

  const expiringProducts = useMemo(() =>
    mockProducts
      .map(p => ({ ...p, expiryStatus: getExpiryStatus(p.expiry_date), days: daysUntil(p.expiry_date) }))
      .filter(p => p.expiryStatus !== 'safe')
      .sort((a, b) => a.days - b.days)
      .slice(0, 6),
    []
  )

  const recentTx = mockTransactions.slice(0, 6).map(tx => ({
    ...tx,
    product: mockProducts.find(p => p.id === tx.product_id),
  }))

  const txTypeLabel: Record<string, string> = {
    inbound: 'Receive', outbound: 'Outbound', adjustment: 'Adjustment',
    barcode_scan: 'Scan', purchase_order_received: 'PO Received',
  }

  const txTypeBadge: Record<string, string> = {
    inbound: 'success', outbound: 'info', adjustment: 'warning',
    barcode_scan: 'purple', purchase_order_received: 'success',
  }

  const expiryBadge: Record<string, string> = {
    expired: 'danger', critical: 'danger', warning: 'warning', safe: 'success',
  }

  const expiryLabel: Record<string, string> = {
    expired: 'Expired', critical: 'Critical', warning: 'Warning', safe: 'Safe',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Page title */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>Dashboard</h1>
          <p style={{ color: '#64748B', fontSize: 14, marginTop: 2 }}>Welcome back — here's what's happening in your inventory.</p>
        </div>
        <div style={{ fontSize: 13, color: '#94A3B8', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Clock size={14} />
          {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        {[
          {
            icon: Package, label: 'Total SKUs', value: kpis.totalSKUs,
            sub: 'Active products', color: '#2FA6B8', bg: '#E0F7FA', trend: `${kpis.totalSKUs} active`,
          },
          {
            icon: TrendingUp, label: 'Total Units in Stock', value: kpis.totalUnits.toLocaleString(),
            sub: 'Across all products', color: '#22C55E', bg: '#DCFCE7', trend: `${kpis.totalUnits.toLocaleString()} units total`,
          },
          {
            icon: AlertTriangle, label: 'Low / Out of Stock', value: kpis.lowOrOut,
            sub: 'Products need attention', color: '#F59E0B', bg: '#FEF3C7', trend: kpis.lowOrOut > 0 ? 'Action required' : 'All stocked',
          },
          {
            icon: DollarSign, label: 'Total Inventory Value', value: formatCurrency(kpis.totalValue),
            sub: 'Cost value on hand', color: '#6366F1', bg: '#EDE9FE', trend: `${formatCurrency(kpis.totalValue)} on hand`,
          },
        ].map(({ icon: Icon, label, value, sub, color, bg, trend }) => (
          <div key={label} className="kpi-card" style={{ position: 'relative', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12,
                background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon size={22} style={{ color }} />
              </div>
              <ArrowUpRight size={16} style={{ color: '#94A3B8' }} />
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', marginBottom: 4 }}>
              {value}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 12, color: '#94A3B8' }}>{sub}</div>
            <div style={{
              marginTop: 12, paddingTop: 12,
              borderTop: '1px solid #F1F5F9',
              fontSize: 12, color, fontWeight: 600,
            }}>{trend}</div>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 16 }}>
        {/* Donut chart */}
        <div className="card" style={{ padding: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>Category Distribution</h3>
          <p style={{ fontSize: 12, color: '#94A3B8', marginBottom: 20 }}>Products by category</p>
          <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={categoryData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={4} dataKey="value">
                  {categoryData.map(({ name }) => (
                    <Cell key={name} fill={COLORS[name as keyof typeof COLORS] ?? '#CBD5E1'} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => [`${v} products`, '']} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 8 }}>
            {categoryData.map(({ name, value }) => (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: COLORS[name as keyof typeof COLORS] }} />
                <span style={{ fontSize: 12, color: '#475569', fontWeight: 500 }}>{name} ({value})</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bar chart */}
        <div className="card" style={{ padding: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>Inventory Status</h3>
          <p style={{ fontSize: 12, color: '#94A3B8', marginBottom: 20 }}>Products by stock level</p>
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusData} barSize={36}>
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748B' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#64748B' }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: '#F8FAFC' }} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                  {statusData.map(({ name }) => (
                    <Cell key={name} fill={STATUS_COLORS[name as keyof typeof STATUS_COLORS]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Bottom row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
        {/* Low Stock Alerts */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>Low Stock Alerts</h3>
            <span style={{ fontSize: 12, color: '#2FA6B8', fontWeight: 600, cursor: 'pointer' }} onClick={() => router.push('/alerts')}>View all →</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {lowStockProducts.map(p => {
              const status = getStockStatus(p)
              return (
                <div key={p.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 12px', borderRadius: 10, background: '#F8FAFC',
                  border: '1px solid #F1F5F9',
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: '#94A3B8' }}>{p.sku}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 8 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: status === 'Out of Stock' ? '#EF4444' : '#F59E0B' }}>
                      {p.stock_quantity}
                    </div>
                    <span className={`badge badge-${status === 'Out of Stock' ? 'danger' : 'warning'}`} style={{ fontSize: 10 }}>
                      {status}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Recent Transactions */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>Recent Transactions</h3>
            <span style={{ fontSize: 12, color: '#2FA6B8', fontWeight: 600, cursor: 'pointer' }} onClick={() => router.push('/stock-movements')}>View all →</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {recentTx.map(tx => (
              <div key={tx.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                padding: '10px 12px', borderRadius: 10, background: '#F8FAFC', border: '1px solid #F1F5F9',
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {tx.product?.name ?? tx.sku}
                  </div>
                  <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
                    {formatDateTime(tx.created_at)}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0, marginLeft: 8 }}>
                  <span className={`badge badge-${txTypeBadge[tx.type] ?? 'gray'}`} style={{ fontSize: 10 }}>
                    {txTypeLabel[tx.type]}
                  </span>
                  <span style={{
                    fontSize: 12, fontWeight: 700,
                    color: tx.type === 'outbound' ? '#EF4444' : '#22C55E',
                  }}>
                    {tx.type === 'outbound' ? '-' : '+'}{Math.abs(tx.quantity)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Expiring Soon */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>Expiring Soon</h3>
            <span style={{ fontSize: 12, color: '#2FA6B8', fontWeight: 600, cursor: 'pointer' }} onClick={() => router.push('/alerts')}>View all →</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {expiringProducts.map(p => (
              <div key={p.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                padding: '10px 12px', borderRadius: 10, background: '#F8FAFC', border: '1px solid #F1F5F9',
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.name}
                  </div>
                  <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
                    Exp: {formatDate(p.expiry_date)}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0, marginLeft: 8 }}>
                  <span className={`badge badge-${expiryBadge[p.expiryStatus]}`} style={{ fontSize: 10 }}>
                    {expiryLabel[p.expiryStatus]}
                  </span>
                  <span style={{ fontSize: 11, color: '#64748B' }}>
                    {p.days < 0 ? `${Math.abs(p.days)}d ago` : `${p.days}d left`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
