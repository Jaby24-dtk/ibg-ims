'use client'

import { useEffect } from 'react'
import { useAuth } from '@/context/AuthContext'
import { Shield } from 'lucide-react'

function StatusScreen({ message }: { message: string }) {
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
      <div style={{ fontSize: 14, color: '#64748B', fontWeight: 500 }}>{message}</div>
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

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, isMockMode } = useAuth()

  useEffect(() => {
    if (!loading && !isMockMode && !user) {
      // A hard navigation, not router.replace() — see login/page.tsx for why:
      // this and the middleware check must each see fresh, real cookies
      // rather than racing client-side state that can diverge from them.
      window.location.href = '/login'
    }
  }, [loading, isMockMode, user])

  if (loading) {
    return <StatusScreen message="Loading I-BG CT Inventory System…" />
  }

  // A session that goes invalid mid-use (expired token, a failed background
  // refresh) lands here too, not just the initial load. Show the branded
  // status screen instead of a blank one while the redirect above completes.
  if (!isMockMode && !user) {
    return <StatusScreen message="Session expired — redirecting to login…" />
  }

  return <>{children}</>
}
