'use client'

import { useState, useEffect } from 'react'
import { Settings, User, Bell, Database, Save, Plus, Trash2, X, Eye, EyeOff, RefreshCw, KeyRound, Truck, Pencil, Tag, Mail, History } from 'lucide-react'
import { formatDate, formatDateTime, generateId } from '@/lib/utils'
import { getSettings, saveSettings, type AppSettings } from '@/lib/app-settings'
import { useRole } from '@/lib/use-role'
import DatabaseStatusPanel from '@/components/settings/DatabaseStatusPanel'

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
  { id: 'suppliers',  label: 'Suppliers',    icon: Truck },
  { id: 'categories', label: 'Categories',   icon: Tag },
  { id: 'alerts',     label: 'Alert Settings', icon: Bell },
  { id: 'email-alerts', label: 'Email Alerts', icon: Mail },
  { id: 'audit-log',  label: 'Audit Log',    icon: History },
  { id: 'database',   label: 'Database',      icon: Database },
]

type SupplierRow = {
  id: string
  name: string
  contact_person: string | null
  email: string | null
  phone: string | null
  address: string | null
  country: string | null
  lead_time_days: number | null
  created_at?: string
}

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
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([])
  const [loadingSuppliers, setLoadingSuppliers] = useState(false)
  const [supplierModalMode, setSupplierModalMode] = useState<'add' | 'edit' | null>(null)
  const [supplierEditId, setSupplierEditId] = useState<string | null>(null)
  const [supplierForm, setSupplierForm] = useState({ name: '', contact_person: '', email: '', phone: '', address: '', country: '', lead_time_days: '' })
  const [supplierError, setSupplierError] = useState('')
  const [savingSupplier, setSavingSupplier] = useState(false)
  const [deletingSupplierId, setDeletingSupplierId] = useState<string | null>(null)
  const [recipients, setRecipients] = useState<{ id: string; email: string }[]>([])
  const [loadingRecipients, setLoadingRecipients] = useState(false)
  const [recipientInput, setRecipientInput] = useState('')
  const [recipientError, setRecipientError] = useState('')
  const [savingRecipient, setSavingRecipient] = useState(false)
  const [deletingRecipientId, setDeletingRecipientId] = useState<string | null>(null)
  type AuditRow = { id: string; actor_name: string | null; actor_email: string | null; action: string; entity_type: string; entity_label: string | null; created_at: string }
  const [auditRows, setAuditRows] = useState<AuditRow[]>([])
  const [loadingAudit, setLoadingAudit] = useState(false)
  const [categories, setCategories] = useState<{ id: string; name: string; created_at?: string }[]>([])
  const [loadingCategories, setLoadingCategories] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const [categoryError, setCategoryError] = useState('')
  const [addingCategory, setAddingCategory] = useState(false)
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null)

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

  async function loadSuppliers() {
    if (!isConfigured) return
    setLoadingSuppliers(true)
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const sb = createClient()
      const { data } = await sb.from('suppliers').select('*').order('name')
      setSuppliers((data ?? []) as SupplierRow[])
    } finally {
      setLoadingSuppliers(false)
    }
  }

  async function loadRecipients() {
    if (!isConfigured) return
    setLoadingRecipients(true)
    setRecipientError('')
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const sb = createClient()
      const { data } = await sb.from('alert_recipients').select('id, email').order('email')
      setRecipients((data ?? []) as { id: string; email: string }[])
    } finally {
      setLoadingRecipients(false)
    }
  }

  async function loadAuditLog() {
    if (!isConfigured) return
    setLoadingAudit(true)
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const sb = createClient()
      const { data } = await sb
        .from('audit_log')
        .select('id, actor_name, actor_email, action, entity_type, entity_label, created_at')
        .order('created_at', { ascending: false })
        .limit(200)
      setAuditRows((data ?? []) as AuditRow[])
    } finally {
      setLoadingAudit(false)
    }
  }

  async function addRecipient(e: React.FormEvent) {
    e.preventDefault()
    const email = recipientInput.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setRecipientError('Enter a valid email address.'); return }
    if (recipients.some(r => r.email.toLowerCase() === email)) { setRecipientError('That address is already on the list.'); return }
    setRecipientError('')
    setSavingRecipient(true)
    try {
      if (isConfigured) {
        const { createClient } = await import('@/lib/supabase/client')
        const sb = createClient()
        const { data, error } = await sb.from('alert_recipients').insert({ email }).select('id, email').single()
        if (error) { setRecipientError(error.message); return }
        setRecipients(prev => [...prev, data as { id: string; email: string }].sort((a, b) => a.email.localeCompare(b.email)))
      } else {
        setRecipients(prev => [...prev, { id: generateId(), email }].sort((a, b) => a.email.localeCompare(b.email)))
      }
      setRecipientInput('')
    } finally {
      setSavingRecipient(false)
    }
  }

  async function removeRecipient(row: { id: string; email: string }) {
    setRecipientError('')
    setDeletingRecipientId(row.id)
    try {
      if (isConfigured) {
        const { createClient } = await import('@/lib/supabase/client')
        const sb = createClient()
        const { error } = await sb.from('alert_recipients').delete().eq('id', row.id)
        if (error) { setRecipientError(error.message); return }
      }
      setRecipients(prev => prev.filter(r => r.id !== row.id))
    } finally {
      setDeletingRecipientId(null)
    }
  }

  async function loadCategories() {
    if (!isConfigured) return
    setLoadingCategories(true)
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const sb = createClient()
      const { data } = await sb.from('categories').select('*').order('name')
      setCategories((data ?? []) as { id: string; name: string; created_at?: string }[])
    } finally {
      setLoadingCategories(false)
    }
  }

  async function addCategory(e: React.FormEvent) {
    e.preventDefault()
    const name = newCategory.trim()
    if (!name) { setCategoryError('Enter a category name.'); return }
    if (categories.some(c => c.name.toLowerCase() === name.toLowerCase())) { setCategoryError('That category already exists.'); return }
    setCategoryError('')
    setAddingCategory(true)
    try {
      if (isConfigured) {
        const { createClient } = await import('@/lib/supabase/client')
        const sb = createClient()
        const { data, error } = await sb.from('categories').insert({ name }).select().single()
        if (error) { setCategoryError(error.message); return }
        setCategories(prev => [...prev, data as { id: string; name: string }].sort((a, b) => a.name.localeCompare(b.name)))
      } else {
        setCategories(prev => [...prev, { id: generateId(), name }].sort((a, b) => a.name.localeCompare(b.name)))
      }
      setNewCategory('')
    } finally {
      setAddingCategory(false)
    }
  }

  async function deleteCategory(row: { id: string; name: string }) {
    setCategoryError('')
    setDeletingCategoryId(row.id)
    try {
      if (isConfigured) {
        const { createClient } = await import('@/lib/supabase/client')
        const sb = createClient()
        const { count } = await sb.from('products').select('id', { count: 'exact', head: true }).eq('category', row.name)
        if ((count ?? 0) > 0) {
          setCategoryError(`${count} product${count === 1 ? '' : 's'} still use "${row.name}" — reassign them first.`)
          return
        }
        if (!confirm(`Delete category "${row.name}"?`)) return
        const { error } = await sb.from('categories').delete().eq('id', row.id)
        if (error) { setCategoryError(error.message); return }
      } else if (!confirm(`Delete category "${row.name}"?`)) {
        return
      }
      setCategories(prev => prev.filter(c => c.id !== row.id))
    } finally {
      setDeletingCategoryId(null)
    }
  }

  function openSupplierModal(row?: SupplierRow) {
    setSupplierError('')
    if (row) {
      setSupplierModalMode('edit')
      setSupplierEditId(row.id)
      setSupplierForm({
        name: row.name ?? '', contact_person: row.contact_person ?? '', email: row.email ?? '',
        phone: row.phone ?? '', address: row.address ?? '', country: row.country ?? '',
        lead_time_days: row.lead_time_days != null ? String(row.lead_time_days) : '',
      })
    } else {
      setSupplierModalMode('add')
      setSupplierEditId(null)
      setSupplierForm({ name: '', contact_person: '', email: '', phone: '', address: '', country: '', lead_time_days: '' })
    }
  }

  async function saveSupplier(e: React.FormEvent) {
    e.preventDefault()
    if (!supplierForm.name.trim()) { setSupplierError('Supplier name is required.'); return }
    const leadRaw = supplierForm.lead_time_days.trim()
    if (leadRaw !== '' && (!/^\d+$/.test(leadRaw) || Number(leadRaw) > 3650)) {
      setSupplierError('Lead time must be a whole number of days (0–3650).'); return
    }
    setSupplierError('')
    setSavingSupplier(true)
    const payload = {
      name: supplierForm.name.trim(),
      contact_person: supplierForm.contact_person.trim() || null,
      email: supplierForm.email.trim() || null,
      phone: supplierForm.phone.trim() || null,
      address: supplierForm.address.trim() || null,
      country: supplierForm.country.trim() || null,
      lead_time_days: leadRaw === '' ? null : Number(leadRaw),
    }
    try {
      if (isConfigured) {
        const { createClient } = await import('@/lib/supabase/client')
        const sb = createClient()
        if (supplierModalMode === 'edit' && supplierEditId) {
          const { data, error } = await sb.from('suppliers').update(payload).eq('id', supplierEditId).select().single()
          if (error) { setSupplierError(error.message); return }
          setSuppliers(prev => prev.map(s => s.id === supplierEditId ? (data as SupplierRow) : s).sort((a, b) => a.name.localeCompare(b.name)))
        } else {
          const { data, error } = await sb.from('suppliers').insert(payload).select().single()
          if (error) { setSupplierError(error.message); return }
          setSuppliers(prev => [...prev, data as SupplierRow].sort((a, b) => a.name.localeCompare(b.name)))
        }
      } else {
        if (supplierModalMode === 'edit' && supplierEditId) {
          setSuppliers(prev => prev.map(s => s.id === supplierEditId ? { ...s, ...payload } : s).sort((a, b) => a.name.localeCompare(b.name)))
        } else {
          setSuppliers(prev => [...prev, { id: generateId(), ...payload }].sort((a, b) => a.name.localeCompare(b.name)))
        }
      }
      setSupplierModalMode(null)
      setSupplierEditId(null)
    } finally {
      setSavingSupplier(false)
    }
  }

  async function deleteSupplier(row: SupplierRow) {
    if (!confirm(`Delete supplier "${row.name}"? A snapshot is kept in the audit log. Any products or purchase orders that used it stay, with the supplier field cleared.`)) return
    setSupplierError('')
    setDeletingSupplierId(row.id)
    try {
      if (isConfigured) {
        const { createClient } = await import('@/lib/supabase/client')
        const sb = createClient()
        // delete_supplier_cascade: audit_log snapshot + null the supplier out of
        // products / purchase_orders, then delete — so it can't be blocked by FKs.
        const { error } = await sb.rpc('delete_supplier_cascade', { s_id: row.id })
        if (error) { setSupplierError(error.message); return }
      }
      setSuppliers(prev => prev.filter(s => s.id !== row.id))
    } finally {
      setDeletingSupplierId(null)
    }
  }

  useEffect(() => {
    if (activeTab === 'users') loadUsers()
    if (activeTab === 'suppliers') loadSuppliers()
    if (activeTab === 'categories') loadCategories()
    if (activeTab === 'email-alerts') loadRecipients()
    if (activeTab === 'audit-log') loadAuditLog()
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
        setInviteSuccess(`User ${inviteForm.name} created successfully. Make sure you've noted their temporary password before closing this window.`)
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
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Home currency (e.g. SGD (S$))</label>
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
                Currency format: type the code and symbol in parentheses, e.g. <strong>SGD (S$)</strong> or <strong>USD ($)</strong>. This is the home currency: totals, reports and purchase orders are shown in it, and products priced in other currencies are converted at daily exchange rates.
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

          {activeTab === 'suppliers' && (
            <div className="card" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '20px 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>Suppliers</h3>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {supplierError && (
                    <span style={{ fontSize: 12, color: '#991B1B', fontWeight: 600 }}>{supplierError}</span>
                  )}
                  <button className="btn-secondary btn-sm" onClick={() => { setSupplierError(''); loadSuppliers() }}>
                    <RefreshCw size={13} style={{ animation: loadingSuppliers ? 'spin 1s linear infinite' : 'none' }} />
                    Refresh
                  </button>
                  <button className="btn-primary btn-sm" onClick={() => openSupplierModal()}>
                    <Plus size={14} /> Add Supplier
                  </button>
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                      {['Supplier', 'Country', 'Lead Time', 'Contact Person', 'Email', 'Phone', 'Actions'].map(col => (
                        <th key={col} style={{ padding: '12px 20px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {suppliers.length === 0 && !loadingSuppliers && (
                      <tr>
                        <td colSpan={7} style={{ padding: '40px 20px', textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
                          {isConfigured ? 'No suppliers yet. Click "Add Supplier" to create one.' : 'Connect Supabase to manage suppliers.'}
                        </td>
                      </tr>
                    )}
                    {suppliers.map((s, i) => (
                      <tr key={s.id} className="table-row-hover" style={{ borderBottom: i < suppliers.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                        <td style={{ padding: '14px 20px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{
                              width: 34, height: 34, borderRadius: 10, background: '#E0F7FA',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                            }}>
                              <Truck size={16} style={{ color: '#2FA6B8' }} />
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{s.name}</div>
                          </div>
                        </td>
                        <td style={{ padding: '14px 20px', fontSize: 13, color: '#374151' }}>{s.country || '—'}</td>
                        <td style={{ padding: '14px 20px', fontSize: 13, color: '#374151' }}>
                          {s.lead_time_days != null ? `${s.lead_time_days} day${s.lead_time_days === 1 ? '' : 's'}` : '—'}
                        </td>
                        <td style={{ padding: '14px 20px', fontSize: 13, color: '#374151' }}>{s.contact_person || '—'}</td>
                        <td style={{ padding: '14px 20px', fontSize: 13, color: '#374151' }}>{s.email || '—'}</td>
                        <td style={{ padding: '14px 20px', fontSize: 13, color: '#374151' }}>{s.phone || '—'}</td>
                        <td style={{ padding: '14px 20px' }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              onClick={() => openSupplierModal(s)}
                              title="Edit supplier"
                              style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid #E2E8F0', background: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748B' }}
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => deleteSupplier(s)}
                              disabled={deletingSupplierId === s.id}
                              title="Delete supplier"
                              style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid #FECACA', background: '#FEE2E2', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#991B1B', opacity: deletingSupplierId === s.id ? 0.4 : 1 }}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: '14px 24px', background: '#F8FAFC', borderTop: '1px solid #E2E8F0', fontSize: 12, color: '#64748B' }}>
                Suppliers appear in the dropdown when creating a Purchase Order, and on the downloaded PO document. Lead time is the supplier&rsquo;s production time in days — the Create PO dialog uses it to estimate when goods will be ready so you know when to order.
              </div>
            </div>
          )}

          {activeTab === 'categories' && (
            <div className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 12, borderBottom: '1px solid #F1F5F9' }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>Product Categories</h3>
                <button className="btn-secondary btn-sm" onClick={() => { setCategoryError(''); loadCategories() }}>
                  <RefreshCw size={13} style={{ animation: loadingCategories ? 'spin 1s linear infinite' : 'none' }} />
                  Refresh
                </button>
              </div>

              <form onSubmit={addCategory} style={{ display: 'flex', gap: 8 }}>
                <input
                  className="input-field" style={{ flex: 1 }} placeholder="New category name (e.g. Consumables)"
                  value={newCategory} onChange={e => setNewCategory(e.target.value)}
                />
                <button type="submit" className="btn-primary btn-sm" disabled={addingCategory}>
                  <Plus size={14} /> {addingCategory ? 'Adding…' : 'Add'}
                </button>
              </form>

              {categoryError && (
                <div style={{ padding: '10px 14px', background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: 10, fontSize: 12, color: '#991B1B', fontWeight: 600 }}>
                  {categoryError}
                </div>
              )}

              {categories.length === 0 && !loadingCategories ? (
                <div style={{ fontSize: 13, color: '#94A3B8', padding: '8px 0' }}>
                  {isConfigured ? 'No categories yet — add one above.' : 'Connect Supabase to manage categories.'}
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {categories.map(c => (
                    <div key={c.id} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      border: '1px solid #E2E8F0', borderRadius: 999, padding: '6px 6px 6px 14px', background: '#F8FAFC',
                    }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{c.name}</span>
                      <button
                        onClick={() => deleteCategory(c)}
                        disabled={deletingCategoryId === c.id}
                        title={`Delete "${c.name}"`}
                        style={{ width: 22, height: 22, borderRadius: '50%', border: '1px solid #FECACA', background: '#FEE2E2', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#991B1B', opacity: deletingCategoryId === c.id ? 0.4 : 1 }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ fontSize: 12, color: '#64748B', background: '#F8FAFC', border: '1px solid #F1F5F9', borderRadius: 10, padding: '12px 14px' }}>
                Categories show up in the Add / Edit Product forms and the Inventory filter. A category that products are still using can&rsquo;t be deleted until those products are moved to another category.
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

          {activeTab === 'email-alerts' && (
            <div className="card" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '20px 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>Email Alerts</h3>
                  <p style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>Addresses that receive the once-a-day digest of open stock &amp; expiry alerts.</p>
                </div>
                <button className="btn-secondary btn-sm" onClick={() => { setRecipientError(''); loadRecipients() }}>
                  <RefreshCw size={13} style={{ animation: loadingRecipients ? 'spin 1s linear infinite' : 'none' }} />
                  Refresh
                </button>
              </div>
              <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <form onSubmit={addRecipient} style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="email" className="input-field" style={{ flex: 1 }} placeholder="name@ibgctasia.com"
                    value={recipientInput} onChange={e => setRecipientInput(e.target.value)}
                  />
                  <button type="submit" className="btn-primary btn-sm" disabled={savingRecipient || !isConfigured}>
                    <Plus size={14} /> {savingRecipient ? 'Adding…' : 'Add'}
                  </button>
                </form>

                {recipientError && (
                  <div style={{ padding: '10px 14px', background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: 10, fontSize: 12, color: '#991B1B', fontWeight: 600 }}>
                    {recipientError}
                  </div>
                )}

                {!isConfigured ? (
                  <div style={{ fontSize: 13, color: '#94A3B8', padding: '8px 0' }}>Connect Supabase to manage email recipients.</div>
                ) : recipients.length === 0 && !loadingRecipients ? (
                  <div style={{ fontSize: 13, color: '#94A3B8', padding: '8px 0' }}>No recipients yet — the daily digest will not be sent until at least one address is added.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {recipients.map(r => (
                      <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 10, background: '#F8FAFC', border: '1px solid #F1F5F9' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#0F172A', fontWeight: 500 }}>
                          <Mail size={14} style={{ color: '#2FA6B8' }} /> {r.email}
                        </span>
                        <button
                          onClick={() => removeRecipient(r)}
                          disabled={deletingRecipientId === r.id}
                          title="Remove recipient"
                          style={{ width: 26, height: 26, borderRadius: '50%', border: '1px solid #FECACA', background: '#FEE2E2', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#991B1B', opacity: deletingRecipientId === r.id ? 0.4 : 1 }}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ fontSize: 12, color: '#64748B', background: '#F8FAFC', border: '1px solid #F1F5F9', borderRadius: 10, padding: '12px 14px', lineHeight: 1.6 }}>
                  The digest is delivered by the <code style={{ fontFamily: 'monospace', fontSize: 11, background: '#EEF2F6', padding: '1px 5px', borderRadius: 4 }}>send-alert-digest</code> Supabase Edge Function. Each alert is emailed once. See <code style={{ fontFamily: 'monospace', fontSize: 11, background: '#EEF2F6', padding: '1px 5px', borderRadius: 4 }}>supabase/functions/send-alert-digest/README.md</code> in the repo for the one-time SMTP + schedule setup.
                </div>
              </div>
            </div>
          )}


          {activeTab === 'audit-log' && (
            <div className="card" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '20px 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>Audit Log</h3>
                  <p style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>Every product or supplier deletion, with who did it and a full snapshot of the record. Append-only.</p>
                </div>
                <button className="btn-secondary btn-sm" onClick={loadAuditLog}>
                  <RefreshCw size={13} style={{ animation: loadingAudit ? 'spin 1s linear infinite' : 'none' }} />
                  Refresh
                </button>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
                      {['When', 'Who', 'Action', 'Type', 'Item'].map(col => (
                        <th key={col} style={{ padding: '12px 20px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {auditRows.length === 0 && !loadingAudit && (
                      <tr>
                        <td colSpan={5} style={{ padding: '40px 20px', textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
                          {isConfigured ? 'No deletions recorded yet.' : 'Connect Supabase to view the audit log.'}
                        </td>
                      </tr>
                    )}
                    {auditRows.map((r, i) => (
                      <tr key={r.id} className="table-row-hover" style={{ borderBottom: i < auditRows.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                        <td style={{ padding: '12px 20px', fontSize: 12, color: '#64748B', whiteSpace: 'nowrap' }}>{formatDateTime(r.created_at)}</td>
                        <td style={{ padding: '12px 20px', fontSize: 13, color: '#374151' }}>{r.actor_name || r.actor_email || '—'}</td>
                        <td style={{ padding: '12px 20px' }}>
                          <span className="badge badge-danger" style={{ fontSize: 11, textTransform: 'capitalize' }}>{r.action}</span>
                        </td>
                        <td style={{ padding: '12px 20px', fontSize: 13, color: '#374151', textTransform: 'capitalize' }}>{r.entity_type}</td>
                        <td style={{ padding: '12px 20px', fontSize: 13, fontWeight: 600, color: '#111827' }}>{r.entity_label || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: '14px 24px', background: '#F8FAFC', borderTop: '1px solid #E2E8F0', fontSize: 12, color: '#64748B' }}>
                Deleting a product or supplier now always succeeds: stock movements and purchase orders are kept, just unlinked from the deleted record. The full snapshot lives here (last 200 shown).
              </div>
            </div>
          )}

          {activeTab === 'database' && (
            <div className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', paddingBottom: 12, borderBottom: '1px solid #F1F5F9' }}>Database & Supabase</h3>
              <DatabaseStatusPanel />
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

      {/* Supplier Add / Edit Modal */}
      {supplierModalMode && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20 }}>
          <div className="card" style={{ width: '100%', maxWidth: 460, padding: 28, position: 'relative', maxHeight: '90vh', overflowY: 'auto' }}>
            <button
              onClick={() => setSupplierModalMode(null)}
              style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}
            >
              <X size={18} />
            </button>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>
              {supplierModalMode === 'edit' ? 'Edit Supplier' : 'Add Supplier'}
            </h3>
            <p style={{ fontSize: 13, color: '#64748B', marginBottom: 20 }}>Only the name is required — the rest shows on the purchase order.</p>
            <form onSubmit={saveSupplier} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Supplier Name *</label>
                <input type="text" className="input-field" required placeholder="e.g. MedSupply Co."
                  value={supplierForm.name} onChange={e => setSupplierForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Contact Person</label>
                  <input type="text" className="input-field" placeholder="e.g. Jane Cruz"
                    value={supplierForm.contact_person} onChange={e => setSupplierForm(f => ({ ...f, contact_person: e.target.value }))} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Phone</label>
                  <input type="text" className="input-field" placeholder="e.g. +63 917 000 0000"
                    value={supplierForm.phone} onChange={e => setSupplierForm(f => ({ ...f, phone: e.target.value }))} />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Email</label>
                <input type="email" className="input-field" placeholder="e.g. orders@medsupply.com"
                  value={supplierForm.email} onChange={e => setSupplierForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Country</label>
                  <input type="text" className="input-field" placeholder="e.g. Germany"
                    value={supplierForm.country} onChange={e => setSupplierForm(f => ({ ...f, country: e.target.value }))} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Lead time to produce (days)</label>
                  <input type="number" min={0} max={3650} className="input-field" placeholder="e.g. 45"
                    value={supplierForm.lead_time_days} onChange={e => setSupplierForm(f => ({ ...f, lead_time_days: e.target.value }))} />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Address</label>
                <textarea className="input-field" rows={2} placeholder="Street, city, country" style={{ resize: 'vertical' }}
                  value={supplierForm.address} onChange={e => setSupplierForm(f => ({ ...f, address: e.target.value }))} />
              </div>
              {supplierError && (
                <div style={{ padding: '10px 14px', background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: 10, fontSize: 12, color: '#991B1B', fontWeight: 600 }}>
                  {supplierError}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
                <button type="button" className="btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => setSupplierModalMode(null)}>Cancel</button>
                <button type="submit" className="btn-primary btn-sm" style={{ flex: 1 }} disabled={savingSupplier}>
                  {savingSupplier ? 'Saving…' : supplierModalMode === 'edit' ? 'Save Changes' : 'Add Supplier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
