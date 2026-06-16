'use client'

import { useState } from 'react'
import { Bell, AlertTriangle, Package, Clock, ShoppingCart, SlidersHorizontal, CheckCircle, X } from 'lucide-react'
import { mockAlerts } from '@/lib/mock-data'
import { formatDateTime } from '@/lib/utils'
import type { Alert, AlertType } from '@/types'

const alertConfig: Record<AlertType, { label: string; icon: React.ElementType; badge: string; color: string }> = {
  low_stock:               { label: 'Low Stock',               icon: AlertTriangle, badge: 'badge-warning', color: '#F59E0B' },
  out_of_stock:            { label: 'Out of Stock',            icon: Package,       badge: 'badge-danger',  color: '#EF4444' },
  expiring_product:        { label: 'Expiring Product',        icon: Clock,         badge: 'badge-danger',  color: '#EF4444' },
  new_purchase_order:      { label: 'New Purchase Order',      icon: ShoppingCart,  badge: 'badge-info',    color: '#38BDF8' },
  inventory_discrepancy:   { label: 'Inventory Discrepancy',   icon: SlidersHorizontal, badge: 'badge-purple', color: '#7C3AED' },
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>(mockAlerts)
  const [typeFilter, setTypeFilter] = useState<'All' | AlertType>('All')
  const [statusFilter, setStatusFilter] = useState<'All' | 'unread' | 'read'>('All')

  const filtered = alerts.filter(a => {
    const matchType = typeFilter === 'All' || a.type === typeFilter
    const matchStatus = statusFilter === 'All' || a.status === statusFilter
    return matchType && matchStatus
  })

  const unreadCount = alerts.filter(a => a.status === 'unread').length

  const markRead = (id: string) => setAlerts(prev => prev.map(a => a.id === id ? { ...a, status: 'read' as const } : a))
  const markAllRead = () => setAlerts(prev => prev.map(a => ({ ...a, status: 'read' as const })))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>Alerts & Notifications</h1>
            {unreadCount > 0 && (
              <span style={{ background: '#EF4444', color: 'white', borderRadius: 999, fontSize: 11, fontWeight: 700, padding: '2px 8px' }}>
                {unreadCount} unread
              </span>
            )}
          </div>
          <p style={{ color: '#64748B', fontSize: 14, marginTop: 2 }}>System alerts for inventory issues, expiry, and more.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {unreadCount > 0 && (
            <button className="btn-secondary btn-sm" onClick={markAllRead}>
              <CheckCircle size={14} /> Mark All Read
            </button>
          )}
        </div>
      </div>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14 }}>
        {Object.entries(alertConfig).map(([type, cfg]) => {
          const count = alerts.filter(a => a.type === type).length
          const Icon = cfg.icon
          return (
            <div
              key={type}
              className="card"
              style={{ padding: '14px 16px', cursor: 'pointer', transition: 'all 0.15s', border: typeFilter === type ? `2px solid ${cfg.color}` : '1px solid #E2E8F0' }}
              onClick={() => setTypeFilter(typeFilter === type ? 'All' : type as AlertType)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon size={16} style={{ color: cfg.color }} />
                <span style={{ fontSize: 18, fontWeight: 800, color: '#0F172A' }}>{count}</span>
              </div>
              <div style={{ fontSize: 11, color: '#64748B', fontWeight: 500, marginTop: 4 }}>{cfg.label}</div>
            </div>
          )
        })}
      </div>

      {/* Filters */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <select className="input-field" style={{ width: 220 }} value={typeFilter} onChange={e => setTypeFilter(e.target.value as 'All' | AlertType)}>
            <option value="All">All Alert Types</option>
            {Object.entries(alertConfig).map(([type, cfg]) => (
              <option key={type} value={type}>{cfg.label}</option>
            ))}
          </select>
          <select className="input-field" style={{ width: 160 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'All' | 'unread' | 'read')}>
            <option value="All">All Status</option>
            <option value="unread">Unread</option>
            <option value="read">Read</option>
          </select>
          {(typeFilter !== 'All' || statusFilter !== 'All') && (
            <button className="btn-secondary btn-sm" onClick={() => { setTypeFilter('All'); setStatusFilter('All') }}>
              <X size={14} /> Clear
            </button>
          )}
          <span style={{ fontSize: 13, color: '#94A3B8', marginLeft: 'auto' }}>{filtered.length} alerts</span>
        </div>
      </div>

      {/* Alerts list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filtered.length === 0 && (
          <div className="card" style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>
            <Bell size={32} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
            <div style={{ fontSize: 14 }}>No alerts match your filters.</div>
          </div>
        )}
        {filtered.map(alert => {
          const cfg = alertConfig[alert.type]
          const Icon = cfg.icon
          const isUnread = alert.status === 'unread'
          return (
            <div
              key={alert.id}
              className="card"
              style={{
                padding: '16px 20px',
                display: 'flex', alignItems: 'flex-start', gap: 14,
                borderLeft: `4px solid ${isUnread ? cfg.color : '#E2E8F0'}`,
                background: isUnread ? 'white' : '#FAFAFA',
                transition: 'all 0.15s',
              }}
            >
              <div style={{
                width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                background: isUnread ? `${cfg.color}18` : '#F1F5F9',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon size={17} style={{ color: isUnread ? cfg.color : '#94A3B8' }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span className={`badge ${isUnread ? cfg.badge : 'badge-gray'}`} style={{ fontSize: 10 }}>{cfg.label}</span>
                  {isUnread && (
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#EF4444', display: 'inline-block' }} />
                  )}
                </div>
                <div style={{ fontSize: 13, fontWeight: isUnread ? 600 : 400, color: isUnread ? '#111827' : '#64748B', lineHeight: 1.5 }}>
                  {alert.message}
                </div>
                <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
                  {formatDateTime(alert.created_at)}
                </div>
              </div>
              {isUnread && (
                <button
                  onClick={() => markRead(alert.id)}
                  style={{
                    flexShrink: 0, background: 'none', border: '1px solid #E2E8F0',
                    borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600,
                    color: '#64748B', cursor: 'pointer', transition: 'all 0.15s',
                    fontFamily: 'Inter, sans-serif', display: 'flex', alignItems: 'center', gap: 5,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#F1F5F9' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
                >
                  <CheckCircle size={13} /> Mark Read
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
