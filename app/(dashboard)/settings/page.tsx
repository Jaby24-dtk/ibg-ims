'use client'

import { useState, useEffect } from 'react'
import { Settings, User, Bell, Database, Save, Plus, Trash2, X, Eye, EyeOff, RefreshCw, KeyRound } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { getSettings, saveSettings, type AppSettings } from '@/lib/app-settings'
import { useRole } from '@/lib/use-role'

type AppUser = { id: string; name: string; email: string; role: string; created_at: string }

const roleConfig: Record<string, { label: string; badge: string }> = {
  administrator:    { label: 'Administrator',     badge: 'badge-danger' },
  inventory_manager:{ label: 'Inventory Manager', badge: 'badge-info' },
  staff:            { label: 'Staff',             badge: 'badge-success' },
  viewer:           { label: 'Viewer',            badge: 'badge-gray' },
}

const tabs = [
  { id: 'general',    label: 'General',       icon: Settings },
  { id: 'users',      label: 'Users & Access', icon: User },
  { id: 'alerts',     label: 'Alert Settings', icon: Bell },
  { id: 'database',   label: 'Database',      icon: Database },
]

export default function SettingsPage() {
  const role = useRole()
  const [activeTab, setActiveTab] = useState('general')
  const [saved, setSaved] = useState(false)
  const [generalForm, setGeneralForm] = useState<AppSettings>(() => getSettings())
  const [users, setUsers] = useState<AppUser[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteForm, setInviteForm] = useState({ name: '', email: '', role: 'staff', password: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [alertSettings, setAlertSettings] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ibg_alert_settings') ?? 'null') || null } catch { return null }
  })
  const [inviteError, setInviteError] = useState('')
  const [inviteSuccess, setInviteSuccess] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [resetTarget, setResetTarget] = useState<AppUser | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [resetError, setResetError] = useState('')
  const [resetSuccess, setResetSuccess] = useState('')
  const [resetting, setResetting] = useState(false)

  const isConfigured = (() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    return url.length > 0 && !url.includes('your-project-ref')
  })()

  async function loadUsers() {
    if (!isConfigured) return
    setLoadingUsers(true)
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const sb = createClient()
      const { data } = await sb.from('users').select('*').order('created_at', { ascending: false })
      setUsers(data ?? [])
    } finally {
      setLoadingUsers(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'users') loadUsers()
  }, [activeTab])

  useEffect(() => {
    if (!isConfigured) return
    import('@/lib/supabase/client').then(({ createClient }) => {
      createClient().auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null))
    })
  }, [])

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviteError('')
    setInviting(true)
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inviteForm),
      })
      const text = await res.text()
      let data: Record<string, string> = {}
      try { data = JSON.parse(text) } catch { /* response wasn't JSON */ }
      if (!res.ok) {
        setInviteError(data.error || `Error ${res.status}: ${text.slice(0, 300)}`)
      } else {
        setInviteSuccess(`User ${inviteForm.name} created! Share their credentials: ${inviteForm.email} / ${inviteForm.password}`)
        setInviteForm({ name: '', email: '', role: 'staff', password: '' })
        loadUsers()
      }
    } catch (err) {
      setInviteError(`Network error: ${String(err)}`)
    } finally {
      setInviting(false)
    }
  }

  async function handleDelete(userId: string, userName: string) {
    if (userId === currentUserId) {
      setDeleteError('You cannot delete your own account.')
      return
    }
    if (!confirm(`Remove ${userName} from the system? This cannot be undone.`)) return
    setDeleteError('')
    setDeletingId(userId)
    try {
      const res = await fetch('/api/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      const text = await res.text()
      let data: Record<string, string> = {}
      try { data = JSON.parse(text) } catch {}
      if (res.ok) {
        loadUsers()
      } else {
        setDeleteError(data.error || `Delete failed (${res.status})`)
      }
    } catch {
      setDeleteError('Network error — please try again')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setResetError('')
    setResetting(true)
    try {
      const res = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: resetTarget?.id, password: resetPassword }),
      })
      const text = await res.text()
      let data: Record<string, string> = {}
      try { data = JSON.parse(text) } catch {}
      if (!res.ok) {
        setResetError(data.error || `Error ${res.status}`)
      } else {
        setResetSuccess(`Password updated! New password: ${resetPassword}`)
      }
    } catch (err) {
      setResetError(`Network error: ${String(err)}`)
    } finally {
      setResetting(false)
    }
  }

  function generatePassword() {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#'
    let pwd = ''
    for (let i = 0; i < 12; i++) pwd += chars[Math.floor(Math.random() * chars.length)]
    setInviteForm(f => ({ ...f, password: pwd }))
  }

  const handleSave = () => {
    saveSettings(generalForm)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  if (role === null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ fontSize: 13, color: '#94A3B8' }}>Loading…</div>
      </div>
    )
  }

  if (role !== 'administrator') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 12, textAlign: 'center' }}>
        <div style={{ fontSize: 48 }}>🔒</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0F172A' }}>Access Restricted</h2>
        <p style={{ fontSize: 14, color: '#64748B', maxWidth: 340 }}>
          Settings are only accessible to Administrators. Contact your admin if you need changes made.
        </p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>Settings</h1>
        <p style={{ color: '#64748B', fontSize: 14, marginTop: 2 }}>System configuration and administration.</p>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        {/* Sidebar tabs */}
        <div className="card" style={{ padding: 8, width: 200, flexShrink: 0 }}>
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', borderRadius: 10, border: 'none',
                background: activeTab === id ? 'rgba(47,166,184,0.1)' : 'transparent',
                color: activeTab === id ? '#2FA6B8' : '#374151',
                fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left',
                transition: 'all 0.15s', fontFamily: 'Inter, sans-serif',
              }}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1 }}>
          {activeTab === 'general' && (
            <div className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', paddingBottom: 12, borderBottom: '1px solid #F1F5F9' }}>
                General Settings
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Company Name</label>
                  <input type="text" className="input-field" value={generalForm.companyName} onChange={e => setGeneralForm(f => ({ ...f, companyName: e.target.value }))} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>System Name</label>
                  <input type="text" className="input-field" value={generalForm.systemName} onChange={e => setGeneralForm(f => ({ ...f, systemName: e.target.value }))} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Business Location</label>
                  <input type="text" className="input-field" value={generalForm.location} onChange={e => setGeneralForm(f => ({ ...f, location: e.target.value }))} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Currency (e.g. SGD (S$))</label>
                  <input type="text" className="input-field" value={generalForm.currency} onChange={e => setGeneralForm(f => ({ ...f, currency: e.target.value }))} placeholder="e.g. SGD (S$) or PHP (₱)" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Default Low Stock Threshold</label>
                  <input type="number" className="input-field" value={generalForm.lowStockThreshold} onChange={e => setGeneralForm(f => ({ ...f, lowStockThreshold: e.target.value }))} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Expiry Warning Days</label>
                  <input type="number" className="input-field" value={generalForm.expiryWarningDays} onChange={e => setGeneralForm(f => ({ ...f, expiryWarningDays: e.target.value }))} />
                </div>
              </div>

              <div style={{ padding: '12px 16px', background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 10, fontSize: 12, color: '#0369A1' }}>
                Currency format: type the code and symbol in parentheses, e.g. <strong>SGD (S$)</strong> or <strong>USD ($)</strong>. The symbol is used throughout the app.
              </div>

              {saved && (
                <div style={{ padding: '10px 14px', background: '#DCFCE7', borderRadius: 10, border: '1px solid #BBF7D0', fontSize: 13, fontWeight: 600, color: '#15803D' }}>
                  Settings saved. Reload any open page to see the updated currency symbol.
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn-primary btn-sm" onClick={handleSave}><Save size={14} /> Save Changes</button>
              </div>
            </div>
          )}

          {activeTab === 'users' && (
            <div className="card" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '20px 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>Users & Access Control</h3>
                <div style={{ display: 'flex', gap: 8 }}>
                  {deleteError && (
                    <span style={{ fontSize: 12, color: '#991B1B', fontWeight: 600 }}>{deleteError}</span>
                  )}
                  <button className="btn-secondary btn-sm" onClick={() => { setDeleteError(''); loadUsers() }}>
                    <RefreshCw size={13} style={{ animation: loadingUsers ? 'spin 1s linear infinite' : 'none' }} />
                    Refresh
                  </button>
                  <button className="btn-primary btn-sm" onClick={() => { setShowInviteModal(true); setInviteSuccess(''); setInviteError('') }}>
                    <Plus size={14} /> Add User
                  </button>
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                      {['User', 'Email', 'Role', 'Created', 'Actions'].map(col => (
                        <th key={col} style={{ padding: '12px 20px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {users.length === 0 && !loadingUsers && (
                      <tr>
                        <td colSpan={5} style={{ padding: '40px 20px', textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
                          {isConfigured ? 'No users yet. Click "Add User" to create one.' : 'Connect Supabase to manage users.'}
                        </td>
                      </tr>
                    )}
                    {users.map((user, i) => {
                      const cfg = roleConfig[user.role] ?? { label: user.role, badge: 'badge-gray' }
                      return (
                        <tr key={user.id} className="table-row-hover" style={{ borderBottom: i < users.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                          <td style={{ padding: '14px 20px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div style={{
                                width: 34, height: 34, borderRadius: '50%',
                                background: 'linear-gradient(135deg, #2FA6B8, #38BDF8)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                color: 'white', fontWeight: 700, fontSize: 13, flexShrink: 0,
                              }}>
                                {user.name.charAt(0).toUpperCase()}
                              </div>
                              <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{user.name}</div>
                            </div>
                          </td>
                          <td style={{ padding: '14px 20px', fontSize: 13, color: '#374151' }}>{user.email}</td>
                          <td style={{ padding: '14px 20px' }}>
                            <span className={`badge ${cfg.badge}`}>{cfg.label}</span>
                          </td>
                          <td style={{ padding: '14px 20px', fontSize: 12, color: '#94A3B8' }}>{formatDate(user.created_at)}</td>
                          <td style={{ padding: '14px 20px' }}>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button
                                onClick={() => { setResetTarget(user); setResetPassword(''); setResetError(''); setResetSuccess('') }}
                                title="Reset password"
                                style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid #BAE6FD', background: '#E0F2FE', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0369A1' }}
                              >
                                <KeyRound size={13} />
                              </button>
                              <button
                                onClick={() => handleDelete(user.id, user.name)}
                                disabled={deletingId === user.id || user.id === currentUserId}
                                title={user.id === currentUserId ? 'Cannot delete your own account' : 'Delete user'}
                                style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid #FECACA', background: '#FEE2E2', cursor: user.id === currentUserId ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#991B1B', opacity: (deletingId === user.id || user.id === currentUserId) ? 0.4 : 1 }}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: '16px 24px', background: '#F8FAFC', borderTop: '1px solid #E2E8F0' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 10 }}>Role Permissions Matrix</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                  {['Permission', 'Administrator', 'Inv. Manager', 'Staff', 'Viewer'].map((h, i) => (
                    <div key={h} style={{ fontSize: 11, fontWeight: i === 0 ? 600 : 700, color: i === 0 ? '#64748B' : '#374151', padding: '6px 8px', background: i === 0 ? 'transparent' : '#E0F7FA', borderRadius: 6, textAlign: i > 0 ? 'center' : 'left' }}>
                      {h}
                    </div>
                  ))}
                  {[
                    ['View Inventory', '✓', '✓', '✓', '✓'],
                    ['Edit Products', '✓', '✓', '✗', '✗'],
                    ['Manage POs', '✓', '✓', '✗', '✗'],
                    ['Approve POs', '✓', '✗', '✗', '✗'],
                    ['System Settings', '✓', '✗', '✗', '✗'],
                    ['Export Reports', '✓', '✓', '✓', '✗'],
                  ].map(([perm, ...vals]) => (
                    vals.map((v, j) => (
                      j === 0
                        ? <div key={`${perm}-label`} style={{ fontSize: 12, color: '#374151', padding: '6px 8px' }}>{perm}</div>
                        : null
                    )).concat(
                      vals.map((v, j) => (
                        <div key={`${perm}-${j}`} style={{ fontSize: 13, textAlign: 'center', padding: '6px 8px', color: v === '✓' ? '#22C55E' : '#EF4444', fontWeight: 700 }}>{v}</div>
                      ))
                    )
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'alerts' && (() => {
            const ALERT_KEYS = [
              { key: 'lowStock',      label: 'Low Stock Alerts',          desc: 'Notify when stock falls below reorder level', def: true },
              { key: 'outOfStock',    label: 'Out of Stock Alerts',        desc: 'Notify when a product reaches zero',           def: true },
              { key: 'expiryWarn',    label: 'Expiry Warnings (<30 days)', desc: 'Alert when products are within 30 days of expiry', def: true },
              { key: 'expiryCrit',    label: 'Expiry Critical (<14 days)', desc: 'Urgent alert for near-expiry products',        def: true },
              { key: 'newPO',         label: 'New Purchase Order',         desc: 'Notify on new PO creation',                   def: true },
              { key: 'poReceived',    label: 'Purchase Order Received',    desc: 'Alert when PO is marked received',             def: false },
              { key: 'discrepancy',   label: 'Inventory Discrepancy',      desc: 'Alert on manual adjustments',                 def: false },
            ]
            const defaults = Object.fromEntries(ALERT_KEYS.map(a => [a.key, a.def]))
            const current: Record<string, boolean> = alertSettings ?? defaults
            const toggle = (key: string) => setAlertSettings((prev: Record<string, boolean> | null) => ({ ...(prev ?? defaults), [key]: !(prev ?? defaults)[key] }))
            const saveAlerts = () => {
              localStorage.setItem('ibg_alert_settings', JSON.stringify(current))
              setSaved(true); setTimeout(() => setSaved(false), 2500)
            }
            return (
              <div className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', paddingBottom: 12, borderBottom: '1px solid #F1F5F9' }}>Alert Settings</h3>
                {ALERT_KEYS.map(({ key, label, desc }) => {
                  const on = current[key] ?? defaults[key]
                  return (
                    <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderBottom: '1px solid #F8FAFC' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{label}</div>
                        <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>{desc}</div>
                      </div>
                      <div onClick={() => toggle(key)} style={{ position: 'relative', width: 44, height: 24, cursor: 'pointer', flexShrink: 0 }}>
                        <div style={{ position: 'absolute', inset: 0, background: on ? '#2FA6B8' : '#E2E8F0', borderRadius: 999, transition: 'background 0.2s' }}>
                          <div style={{ position: 'absolute', top: 3, left: on ? 22 : 3, width: 18, height: 18, borderRadius: '50%', background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.2s' }} />
                        </div>
                      </div>
                    </div>
                  )
                })}
                {saved && <div style={{ padding: '10px 14px', background: '#DCFCE7', borderRadius: 10, border: '1px solid #BBF7D0', fontSize: 13, fontWeight: 600, color: '#15803D' }}>Alert settings saved.</div>}
                <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 8 }}>
                  <button className="btn-primary btn-sm" onClick={saveAlerts}><Save size={14} /> Save Alert Settings</button>
                </div>
              </div>
            )
          })()}

          {activeTab === 'database' && (
            <div className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', paddingBottom: 12, borderBottom: '1px solid #F1F5F9' }}>Database & Supabase</h3>
              <div style={{ padding: 20, background: '#F0FDF4', borderRadius: 12, border: '1px solid #BBF7D0' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#15803D', marginBottom: 4 }}>Connection Status</div>
                <div style={{ fontSize: 12, color: '#166534' }}>
                  Running with mock data. Connect a Supabase project in General Settings to enable persistent storage.
                </div>
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', marginBottom: 10 }}>Database Tables</div>
                {['products', 'suppliers', 'purchase_orders', 'purchase_order_items', 'transactions', 'alerts', 'users'].map(table => (
                  <div key={table} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: 10, background: '#F8FAFC', border: '1px solid #F1F5F9', marginBottom: 6 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#2FA6B8', fontWeight: 600 }}>{table}</span>
                    <span className="badge badge-info" style={{ fontSize: 10 }}>Schema Ready</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-secondary btn-sm"><Database size={14} /> Run Migrations</button>
                <button className="btn-secondary btn-sm"><Database size={14} /> Seed Sample Data</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Reset Password Modal */}
      {resetTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20 }}>
          <div className="card" style={{ width: '100%', maxWidth: 420, padding: 28, position: 'relative' }}>
            <button onClick={() => setResetTarget(null)} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}>
              <X size={18} />
            </button>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>Reset Password</h3>
            <p style={{ fontSize: 13, color: '#64748B', marginBottom: 20 }}>
              Set a new password for <strong>{resetTarget.name}</strong> ({resetTarget.email})
            </p>
            {resetSuccess ? (
              <div>
                <div style={{ padding: 16, background: '#DCFCE7', border: '1px solid #BBF7D0', borderRadius: 12, marginBottom: 16, fontSize: 13, color: '#166534', fontWeight: 600 }}>
                  {resetSuccess}
                </div>
                <button className="btn-primary btn-sm" style={{ width: '100%' }} onClick={() => setResetTarget(null)}>Done</button>
              </div>
            ) : (
              <form onSubmit={handleReset} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>New Password *</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="text" className="input-field" required placeholder="Min. 8 characters" style={{ flex: 1 }}
                      value={resetPassword}
                      onChange={e => setResetPassword(e.target.value)}
                    />
                    <button type="button" className="btn-secondary btn-sm" onClick={() => {
                      const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#'
                      let pwd = ''; for (let i = 0; i < 12; i++) pwd += chars[Math.floor(Math.random() * chars.length)]
                      setResetPassword(pwd)
                    }}>Generate</button>
                  </div>
                </div>
                {resetError && (
                  <div style={{ padding: '10px 14px', background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: 10, fontSize: 12, color: '#991B1B', fontWeight: 600 }}>
                    {resetError}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => setResetTarget(null)}>Cancel</button>
                  <button type="submit" className="btn-primary btn-sm" style={{ flex: 1 }} disabled={resetting}>
                    {resetting ? 'Updating...' : 'Set New Password'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Invite User Modal */}
      {showInviteModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20,
        }}>
          <div className="card" style={{ width: '100%', maxWidth: 480, padding: 28, position: 'relative', maxHeight: '90vh', overflowY: 'auto' }}>
            <button
              onClick={() => { setShowInviteModal(false); setInviteSuccess(''); setInviteError('') }}
              style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}
            >
              <X size={18} />
            </button>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>Add New User</h3>
            <p style={{ fontSize: 13, color: '#64748B', marginBottom: 20 }}>Create an account and share credentials with the new team member.</p>

            {inviteSuccess ? (
              <div>
                <div style={{ padding: 16, background: '#DCFCE7', border: '1px solid #BBF7D0', borderRadius: 12, marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#15803D', marginBottom: 6 }}>User created successfully!</div>
                  <div style={{ fontSize: 12, color: '#166534', lineHeight: 1.6, wordBreak: 'break-all' }}>{inviteSuccess}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-primary btn-sm" style={{ flex: 1 }} onClick={() => { setInviteSuccess(''); setInviteError('') }}>
                    Add Another
                  </button>
                  <button className="btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => { setShowInviteModal(false); setInviteSuccess('') }}>
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleInvite} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Full Name *</label>
                  <input
                    type="text" className="input-field" required placeholder="e.g. Maria Santos"
                    value={inviteForm.name}
                    onChange={e => setInviteForm(f => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Email Address *</label>
                  <input
                    type="email" className="input-field" required placeholder="user@company.com"
                    value={inviteForm.email}
                    onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Role *</label>
                  <select
                    className="input-field" required
                    value={inviteForm.role}
                    onChange={e => setInviteForm(f => ({ ...f, role: e.target.value }))}
                  >
                    <option value="staff">Staff</option>
                    <option value="inventory_manager">Inventory Manager</option>
                    <option value="administrator">Administrator</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Password *</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1, position: 'relative' }}>
                      <input
                        type={showPassword ? 'text' : 'password'} className="input-field" required
                        placeholder="Min. 8 characters" style={{ paddingRight: 40 }}
                        value={inviteForm.password}
                        onChange={e => setInviteForm(f => ({ ...f, password: e.target.value }))}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(p => !p)}
                        style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}
                      >
                        {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                    <button type="button" className="btn-secondary btn-sm" onClick={generatePassword} style={{ whiteSpace: 'nowrap' }}>
                      Generate
                    </button>
                  </div>
                </div>
                {inviteError && (
                  <div style={{ padding: '10px 14px', background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: 10, fontSize: 12, color: '#991B1B', fontWeight: 600 }}>
                    {inviteError}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
                  <button type="button" className="btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => setShowInviteModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary btn-sm" style={{ flex: 1 }} disabled={inviting}>
                    {inviting ? 'Creating...' : 'Create User'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
