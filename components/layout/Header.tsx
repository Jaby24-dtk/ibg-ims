'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search, Bell, ChevronDown, LogOut,
  AlertTriangle, CheckCircle, Info,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { mockAlerts } from '@/lib/mock-data'

const roleLabels: Record<string, string> = {
  administrator: 'Administrator',
  inventory_manager: 'Inventory Manager',
  staff: 'Staff',
  viewer: 'Viewer',
}

export default function Header() {
  const { profile, signOut } = useAuth()
  const router = useRouter()
  const [profileOpen, setProfileOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)

  const displayName = profile?.name ?? '…'
  const displayRole = profile?.role ? roleLabels[profile.role] : ''
  const displayInitial = displayName.charAt(0).toUpperCase()

  const unreadCount = mockAlerts.filter(a => a.status === 'unread').length

  const alertIcon = (type: string) => {
    if (type === 'out_of_stock' || type === 'low_stock') return <AlertTriangle size={14} style={{ color: '#F59E0B', flexShrink: 0 }} />
    if (type === 'expiring_product') return <AlertTriangle size={14} style={{ color: '#EF4444', flexShrink: 0 }} />
    return <Info size={14} style={{ color: '#2FA6B8', flexShrink: 0 }} />
  }

  return (
    <header style={{
      background: 'white',
      borderBottom: '1px solid #E2E8F0',
      padding: '0 24px',
      height: 64,
      display: 'flex', alignItems: 'center', gap: 16,
      position: 'sticky', top: 0, zIndex: 30,
    }}>
      {/* Search */}
      <div style={{ flex: 1, maxWidth: 420, position: 'relative' }}>
        <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
        <input
          className="input-field"
          placeholder="Search products, SKUs, barcodes..."
          style={{ paddingLeft: 36, background: '#F8FAFC' }}
        />
      </div>

      <div style={{ flex: 1 }} />

      {/* Notifications */}
      <div style={{ position: 'relative' }}>
        <button
          style={{
            position: 'relative', background: 'none', border: 'none',
            cursor: 'pointer', padding: 8, borderRadius: 8,
            color: '#64748B', transition: 'background 0.15s',
          }}
          onClick={() => { setNotifOpen(!notifOpen); setProfileOpen(false) }}
          onMouseEnter={e => (e.currentTarget.style.background = '#F1F5F9')}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
        >
          <Bell size={20} />
          {unreadCount > 0 && (
            <span style={{
              position: 'absolute', top: 4, right: 4,
              background: '#EF4444', color: 'white',
              borderRadius: 999, fontSize: 9, fontWeight: 700,
              width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '2px solid white',
            }}>{unreadCount > 9 ? '9+' : unreadCount}</span>
          )}
        </button>

        {notifOpen && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setNotifOpen(false)} />
            <div style={{
              position: 'absolute', top: 'calc(100% + 8px)', right: 0,
              background: 'white', borderRadius: 12,
              border: '1px solid #E2E8F0',
              boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
              width: 340, zIndex: 50, overflow: 'hidden',
              maxHeight: 420,
            }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>
                  Notifications {unreadCount > 0 && <span style={{ background: '#EF4444', color: 'white', borderRadius: 999, fontSize: 10, padding: '1px 6px', marginLeft: 6 }}>{unreadCount}</span>}
                </div>
                <button
                  onClick={() => { setNotifOpen(false); router.push('/alerts') }}
                  style={{ background: 'none', border: 'none', fontSize: 12, color: '#2FA6B8', cursor: 'pointer', fontWeight: 600 }}
                >
                  View all
                </button>
              </div>
              <div style={{ overflowY: 'auto', maxHeight: 340 }}>
                {mockAlerts.length === 0 ? (
                  <div style={{ padding: '24px 16px', textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
                    <CheckCircle size={24} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
                    No notifications
                  </div>
                ) : (
                  mockAlerts.slice(0, 8).map(alert => (
                    <div
                      key={alert.id}
                      style={{
                        padding: '10px 16px',
                        borderBottom: '1px solid #F8FAFC',
                        background: alert.status === 'unread' ? '#FAFCFF' : 'white',
                        cursor: 'pointer',
                        display: 'flex', gap: 10, alignItems: 'flex-start',
                      }}
                      onClick={() => { setNotifOpen(false); router.push('/alerts') }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#F8FAFC')}
                      onMouseLeave={e => (e.currentTarget.style.background = alert.status === 'unread' ? '#FAFCFF' : 'white')}
                    >
                      <div style={{ marginTop: 2 }}>{alertIcon(alert.type)}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.4, fontWeight: alert.status === 'unread' ? 600 : 400 }}>
                          {alert.message}
                        </div>
                        <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 3 }}>
                          {new Date(alert.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </div>
                      </div>
                      {alert.status === 'unread' && (
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#2FA6B8', flexShrink: 0, marginTop: 5 }} />
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Profile */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => { setProfileOpen(!profileOpen); setNotifOpen(false) }}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '6px 8px', borderRadius: 10,
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = '#F1F5F9')}
          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
        >
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'linear-gradient(135deg, #2FA6B8, #38BDF8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white', fontWeight: 700, fontSize: 13,
          }}>
            {displayInitial}
          </div>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{displayName}</div>
            <div style={{ fontSize: 11, color: '#64748B' }}>{displayRole}</div>
          </div>
          <ChevronDown size={14} style={{ color: '#94A3B8' }} />
        </button>

        {profileOpen && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setProfileOpen(false)} />
            <div style={{
              position: 'absolute', top: 'calc(100% + 8px)', right: 0,
              background: 'white', borderRadius: 12,
              border: '1px solid #E2E8F0',
              boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
              width: 200, zIndex: 50, overflow: 'hidden',
            }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #F1F5F9' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>{displayName}</div>
                <div style={{ fontSize: 11, color: '#64748B' }}>{profile?.email ?? ''}</div>
                {displayRole && (
                  <span className="badge badge-info" style={{ fontSize: 10, marginTop: 4 }}>{displayRole}</span>
                )}
              </div>
              {[
                { icon: LogOut, label: 'Sign Out', action: () => { setProfileOpen(false); signOut() } },
              ].map(({ icon: Icon, label, action }) => (
                <button
                  key={label}
                  onClick={action}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 16px', width: '100%',
                    background: 'transparent', border: 'none',
                    fontSize: 13, fontWeight: 500, color: label === 'Sign Out' ? '#EF4444' : '#374151',
                    cursor: 'pointer', transition: 'background 0.1s',
                    fontFamily: 'Inter, sans-serif',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#F8FAFC')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <Icon size={15} />
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </header>
  )
}
