'use client'

import { useAuth } from '@/context/AuthContext'
import { Shield } from 'lucide-react'

function StatusScreen({ message, debug }: { message: string; debug?: string }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#F8FAFC', flexDirection: 'column', gap: 16, padding: 24,
    }}>
      <div style={{
        width: 48, height: 48, borderRadius: 14,
        background: 'linear-gradient(135deg, #2FA6B8, #38BDF8)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Shield size={24} color="white" />
      </div>
      <div style={{ fontSize: 14, color: '#64748B', fontWeight: 500 }}>{message}</div>
      {!debug && (
        <div style={{
          width: 160, height: 3, background: '#E2E8F0', borderRadius: 999, overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', borderRadius: 999,
            background: 'linear-gradient(90deg, #2FA6B8, #38BDF8)',
            animation: 'loadBar 1.2s ease-in-out infinite',
          }} />
        </div>
      )}
      {debug && (
        <>
          <div style={{
            background: '#0F172A', color: '#E2E8F0', borderRadius: 10, padding: '14px 16px',
            fontSize: 11, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            maxWidth: 700, maxHeight: 320, overflow: 'auto',
          }}>
            {debug}
          </div>
          <button
            className="btn-primary"
            style={{ padding: '10px 18px', fontSize: 14 }}
            onClick={() => { window.location.href = '/login' }}
          >
            Go to Login
          </button>
        </>
      )}
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
  const { user, profile, loading, isMockMode, authDebug } = useAuth()

  // TEMP DIAGNOSTIC (2026-08-19): the auto-redirect to /login is disabled
  // while this is in place — see the "Go to Login" button on the debug panel
  // below instead. Remove this whole diagnostic block (and re-enable the
  // useEffect redirect) once the post-middleware-fix bounce-back is
  // root-caused. Middleware now trusts a locally-valid cookie and lets the
  // request through to /dashboard, but the browser's own client-side check
  // (AuthContext) is then separately concluding there's no user — this panel
  // shows exactly what that check saw.
  //
  // useEffect(() => {
  //   if (!loading && !isMockMode && !user) {
  //     window.location.href = '/login'
  //   }
  // }, [loading, isMockMode, user])

  if (loading) {
    return <StatusScreen message="Loading I-BG CT Inventory System…" />
  }

  if (!isMockMode && !user) {
    return (
      <StatusScreen
        message="No user — this is what AuthContext saw:"
        debug={authDebug ?? '(no debug info captured)'}
      />
    )
  }

  return <>{children}</>
}
