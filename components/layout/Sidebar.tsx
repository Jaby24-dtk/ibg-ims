'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Package, ArrowLeftRight, ShoppingCart,
  Bell, BarChart2, Settings, ChevronRight,
} from 'lucide-react'
import { mockAlerts } from '@/lib/mock-data'
import { useRole } from '@/lib/use-role'

const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/inventory', icon: Package, label: 'Inventory' },
  { href: '/stock-movements', icon: ArrowLeftRight, label: 'Stock Movements' },
  { href: '/purchase-orders', icon: ShoppingCart, label: 'Purchase Orders' },
  { href: '/alerts', icon: Bell, label: 'Alerts & Notifications' },
  { href: '/reports', icon: BarChart2, label: 'Reports & Analytics' },
  { href: '/settings', icon: Settings, label: 'Settings' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const role = useRole()
  const unreadAlerts = mockAlerts.filter(a => a.status === 'unread').length
  const isAdmin = role === 'administrator'

  return (
    <aside
      style={{ background: 'white', width: 240, minHeight: '100vh', display: 'flex', flexDirection: 'column', borderRight: '1px solid #E2E8F0' }}
      className="flex-shrink-0"
    >
      {/* Logo */}
      <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid #F1F5F9' }}>
        <Image
          src="/company-logo.png"
          alt="I-BG CT Asia"
          width={160}
          height={83}
          style={{ width: 160, height: 'auto' }}
          priority
        />
        <div style={{ color: '#94A3B8', fontSize: 10, fontWeight: 500, letterSpacing: '0.07em', textTransform: 'uppercase', marginTop: 6 }}>
          Inventory System
        </div>
      </div>

      {/* Nav */}
      <nav style={{ padding: '16px 12px', flex: 1 }}>
        <div style={{ marginBottom: 6 }}>
          <span style={{ color: '#94A3B8', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '0 8px' }}>
            Main Menu
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8 }}>
          {navItems.filter(item => item.href !== '/settings' || isAdmin).map(({ href, icon: Icon, label }) => {
            const active = pathname === href || pathname.startsWith(href + '/')
            return (
              <Link key={href} href={href} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 12px', borderRadius: 10, fontSize: 13, fontWeight: 500,
                textDecoration: 'none', transition: 'all 0.15s',
                background: active ? '#E0F7FA' : 'transparent',
                color: active ? '#2FA6B8' : '#374151',
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#F8FAFC' }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
              >
                <Icon size={17} style={{ color: active ? '#2FA6B8' : '#64748B', flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{label}</span>
                {href === '/alerts' && unreadAlerts > 0 ? (
                  <span style={{
                    background: '#EF4444', color: 'white',
                    borderRadius: 999, fontSize: 10, fontWeight: 700,
                    padding: '1px 6px', minWidth: 18, textAlign: 'center',
                  }}>
                    {unreadAlerts}
                  </span>
                ) : (
                  active && <ChevronRight size={14} style={{ opacity: 0.4, color: '#2FA6B8' }} />
                )}
              </Link>
            )
          })}
        </div>
      </nav>

      {/* Footer */}
      <div style={{ padding: '16px 12px', borderTop: '1px solid #F1F5F9' }}>
        <div style={{
          background: '#F0FDFE',
          border: '1px solid #BAE6FD',
          borderRadius: 10, padding: '10px 12px',
        }}>
          <div style={{ color: '#0891B2', fontSize: 11, fontWeight: 600, marginBottom: 2 }}>I-BG CT Asia</div>
          <div style={{ color: '#64748B', fontSize: 10 }}>Authorized personnel only</div>
        </div>
      </div>
    </aside>
  )
}
