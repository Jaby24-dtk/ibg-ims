'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'
import { Shield } from 'lucide-react'

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, isMockMode } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !isMockMode && !user) {
      router.replace('/login')
    }
  }, [loading, isMockMode, user, router])

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#F8FAFC', flexDirection: 'column', gap: 16,
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 14,
          background: 'linear-gradient(135deg, #2FA6B8, #38BDF8)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Shield size={24} color="white" />
        </div>
        <div style={{ fontSize: 14, color: '#64748B', fontWeight: 500 }}>Loading I-BG CT Inventory System…</div>
        <div style={{
          width: 160, height: 3, background: '#E2E8F0', borderRadius: 999, overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', borderRadius: 999,
            background: 'linear-gradient(90deg, #2FA6B8, #38BDF8)',
            animation: 'loadBar 1.2s ease-in-out infinite',
          }} />
        </div>
        <style>{`
          @keyframes loadBar {
            0%   { width: 0%;   margin-left: 0%; }
            50%  { width: 60%;  margin-left: 20%; }
            100% { width: 0%;   margin-left: 100%; }
          }
        `}</style>
      </div>
    )
  }

  if (!isMockMode && !user) return null

  return <>{children}</>
}
