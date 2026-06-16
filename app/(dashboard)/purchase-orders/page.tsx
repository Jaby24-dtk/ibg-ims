'use client'

import { useState } from 'react'
import { ShoppingCart, Plus, X, Check, Eye, Edit2, Package, FileText } from 'lucide-react'
import { mockPurchaseOrders, mockSuppliers } from '@/lib/mock-data'
import { formatCurrency, formatDate, generateOrderNumber, generateId } from '@/lib/utils'
import type { PurchaseOrder, PurchaseOrderStatus } from '@/types'
import { useRole, canEdit, canExport } from '@/lib/use-role'

const statusConfig: Record<PurchaseOrderStatus, { label: string; badge: string }> = {
  draft:      { label: 'Draft',      badge: 'badge-gray' },
  pending:    { label: 'Pending',    badge: 'badge-warning' },
  approved:   { label: 'Approved',   badge: 'badge-info' },
  received:   { label: 'Received',   badge: 'badge-success' },
  cancelled:  { label: 'Cancelled',  badge: 'badge-danger' },
}

export default function PurchaseOrdersPage() {
  const role = useRole()
  const [orders, setOrders] = useState<PurchaseOrder[]>(mockPurchaseOrders)
  const [showModal, setShowModal] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null)
  const [selectedSupplier, setSelectedSupplier] = useState(mockSuppliers[0]?.id ?? '')
  const [orderNotes, setOrderNotes] = useState('')

  const summary = {
    total: orders.length,
    draft: orders.filter(o => o.status === 'draft').length,
    pending: orders.filter(o => o.status === 'pending').length,
    approved: orders.filter(o => o.status === 'approved').length,
    received: orders.filter(o => o.status === 'received').length,
    cancelled: orders.filter(o => o.status === 'cancelled').length,
  }

  const updateStatus = (id: string, status: PurchaseOrderStatus) => {
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status, updated_at: new Date().toISOString() } : o))
    setSelectedOrder(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>Purchase Orders</h1>
          <p style={{ color: '#64748B', fontSize: 14, marginTop: 2 }}>Manage supplier orders and track deliveries.</p>
        </div>
        {canEdit(role) && (
          <button className="btn-primary btn-sm" onClick={() => setShowModal(true)}>
            <Plus size={14} /> Create Order
          </button>
        )}
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 14 }}>
        {[
          { label: 'Total Orders', value: summary.total, color: '#0F172A', bg: '#F1F5F9' },
          { label: 'Draft', value: summary.draft, color: '#475569', bg: '#F1F5F9' },
          { label: 'Pending', value: summary.pending, color: '#92400E', bg: '#FEF3C7' },
          { label: 'Approved', value: summary.approved, color: '#0369A1', bg: '#E0F2FE' },
          { label: 'Received', value: summary.received, color: '#15803D', bg: '#DCFCE7' },
          { label: 'Cancelled', value: summary.cancelled, color: '#991B1B', bg: '#FEE2E2' },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className="card" style={{ padding: '14px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color }}>{value}</div>
            <div style={{ fontSize: 12, color: '#64748B', fontWeight: 500, marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                {['Order #', 'Supplier', 'Total Cost', 'Status', 'Created', 'Actions'].map(col => (
                  <th key={col} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map((order, i) => {
                const supplier = mockSuppliers.find(s => s.id === order.supplier_id)
                const cfg = statusConfig[order.status]
                return (
                  <tr key={order.id} className="table-row-hover" style={{ borderBottom: i < orders.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', fontFamily: 'monospace' }}>{order.order_number}</div>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{supplier?.name ?? '—'}</div>
                      <div style={{ fontSize: 11, color: '#94A3B8' }}>{supplier?.contact_person}</div>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>{formatCurrency(order.total_cost)}</div>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span className={`badge ${cfg.badge}`}>{cfg.label}</span>
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 12, color: '#64748B', whiteSpace: 'nowrap' }}>
                      {formatDate(order.created_at)}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => setSelectedOrder(order)}
                          style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid #E2E8F0', background: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748B' }}
                          title="View"
                        >
                          <Eye size={14} />
                        </button>
                        {canEdit(role) && order.status === 'pending' && (
                          <button
                            onClick={() => updateStatus(order.id, 'approved')}
                            style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid #BBF7D0', background: '#DCFCE7', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#15803D' }}
                            title="Approve"
                          >
                            <Check size={14} />
                          </button>
                        )}
                        {canEdit(role) && order.status === 'approved' && (
                          <button
                            onClick={() => updateStatus(order.id, 'received')}
                            className="btn-primary btn-sm"
                            style={{ height: 30, padding: '0 10px' }}
                            title="Mark Received"
                          >
                            <Package size={12} /> Received
                          </button>
                        )}
                        {canEdit(role) && (order.status === 'draft' || order.status === 'pending') && (
                          <button
                            onClick={() => updateStatus(order.id, 'cancelled')}
                            style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid #FECACA', background: '#FEE2E2', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#991B1B' }}
                            title="Cancel"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* View Order Modal */}
      {selectedOrder && (
        <div className="modal-overlay" onClick={() => setSelectedOrder(null)}>
          <div className="modal-box" style={{ width: 520, padding: 0 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>{selectedOrder.order_number}</h2>
                <span className={`badge ${statusConfig[selectedOrder.status].badge}`} style={{ marginTop: 4 }}>
                  {statusConfig[selectedOrder.status].label}
                </span>
              </div>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }} onClick={() => setSelectedOrder(null)}>
                <X size={20} />
              </button>
            </div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { label: 'Supplier', value: mockSuppliers.find(s => s.id === selectedOrder.supplier_id)?.name ?? '—' },
                { label: 'Contact', value: mockSuppliers.find(s => s.id === selectedOrder.supplier_id)?.contact_person ?? '—' },
                { label: 'Total Cost', value: formatCurrency(selectedOrder.total_cost) },
                { label: 'Created', value: formatDate(selectedOrder.created_at) },
                { label: 'Last Updated', value: formatDate(selectedOrder.updated_at) },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', background: '#F8FAFC', borderRadius: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#64748B' }}>{label}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{value}</span>
                </div>
              ))}
              {selectedOrder.notes && (
                <div style={{ padding: '10px 12px', background: '#F8FAFC', borderRadius: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', marginBottom: 4 }}>Notes</div>
                  <div style={{ fontSize: 13, color: '#374151' }}>{selectedOrder.notes}</div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 8, borderTop: '1px solid #F1F5F9' }}>
                {canEdit(role) && selectedOrder.status === 'pending' && (
                  <button className="btn-primary btn-sm" onClick={() => updateStatus(selectedOrder.id, 'approved')}>
                    <Check size={14} /> Approve
                  </button>
                )}
                {canEdit(role) && selectedOrder.status === 'approved' && (
                  <button className="btn-primary btn-sm" onClick={() => updateStatus(selectedOrder.id, 'received')}>
                    <Package size={14} /> Mark Received
                  </button>
                )}
                <button className="btn-secondary btn-sm" onClick={() => setSelectedOrder(null)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Order Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-box" style={{ width: 520, padding: 0 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>Create Purchase Order</h2>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }} onClick={() => setShowModal(false)}><X size={20} /></button>
            </div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Supplier</label>
                <select
                  className="input-field"
                  value={selectedSupplier}
                  onChange={e => setSelectedSupplier(e.target.value)}
                >
                  {mockSuppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Notes</label>
                <textarea
                  className="input-field"
                  rows={3}
                  placeholder="Order notes..."
                  style={{ resize: 'vertical' }}
                  value={orderNotes}
                  onChange={e => setOrderNotes(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 8, borderTop: '1px solid #F1F5F9' }}>
                <button className="btn-secondary btn-sm" onClick={() => setShowModal(false)}>Cancel</button>
                <button
                  className="btn-primary btn-sm"
                  onClick={() => {
                    const newOrder: PurchaseOrder = {
                      id: generateId(), order_number: generateOrderNumber(),
                      supplier_id: selectedSupplier, status: 'draft', total_cost: 0,
                      notes: orderNotes.trim() || undefined, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
                    }
                    setOrders(prev => [newOrder, ...prev])
                    setOrderNotes('')
                    setSelectedSupplier(mockSuppliers[0]?.id ?? '')
                    setShowModal(false)
                  }}
                >
                  <Plus size={14} /> Create Draft
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
