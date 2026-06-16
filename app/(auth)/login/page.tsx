'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Eye, EyeOff, Lock, Mail } from 'lucide-react'

function isSupabaseConfigured() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return url.length > 0 && !url.includes('your-project-ref')
}

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const mockMode = !isSupabaseConfigured()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (mockMode) {
      // Demo mode — any email+password works
      await new Promise(r => setTimeout(r, 600))
      router.push('/dashboard')
      return
    }

    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
      if (authError) {
        setError(authError.message === 'Invalid login credentials'
          ? 'Incorrect email or password. Please try again.'
          : authError.message)
        setLoading(false)
      } else {
        router.push('/dashboard')
        router.refresh()
      }
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex',
      background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #0F2A3A 100%)',
    }}>
      {/* Left panel */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: 48, color: 'white',
      }}>
        <div style={{ maxWidth: 440 }}>
          <div style={{ marginBottom: 48 }}>
            <Image
              src="/company-logo.png"
              alt="I-BG CT Asia"
              width={200}
              height={104}
              style={{ width: 200, height: 'auto' }}
              priority
            />
            <div style={{ color: '#64748B', fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 8 }}>
              Inventory Management System
            </div>
          </div>

          <h1 style={{ fontSize: 36, fontWeight: 800, lineHeight: 1.15, marginBottom: 16, letterSpacing: '-0.02em' }}>
            Internal<br />
            <span style={{ background: 'linear-gradient(90deg, #2FA6B8, #38BDF8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Access Portal
            </span>
          </h1>
          <p style={{ color: '#94A3B8', fontSize: 15, lineHeight: 1.6 }}>
            Secure access for authorized I-BG CT Asia personnel only.
          </p>

          <div style={{ marginTop: 48, display: 'flex', flexDirection: 'column', gap: 20 }}>
            {[
              { icon: '🏥', title: 'Medical Products', desc: 'PPE, diagnostics, health equipment' },
              { icon: '🔍', title: 'Detection Products', desc: 'Security scanners, test kits' },
              { icon: '📊', title: 'Real-time Analytics', desc: 'Stock levels, expiry tracking' },
            ].map(({ icon, title, desc }) => (
              <div key={title} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10,
                  background: 'rgba(47,166,184,0.12)',
                  border: '1px solid rgba(47,166,184,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 18, flexShrink: 0,
                }}>{icon}</div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
                  <div style={{ color: '#64748B', fontSize: 13 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel — form */}
      <div style={{
        width: 460, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 40, background: 'white',
      }}>
        <div style={{ width: '100%', maxWidth: 380 }}>
          <div style={{ marginBottom: 32 }}>
            <Image
              src="/company-logo.png"
              alt="I-BG CT Asia"
              width={140}
              height={73}
              style={{ width: 140, height: 'auto', marginBottom: 20 }}
              priority
            />
            <h2 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>Sign in</h2>
            <p style={{ color: '#64748B', fontSize: 14 }}>Use your I-BG CT Asia email and password.</p>
          </div>

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                Email address
              </label>
              <div style={{ position: 'relative' }}>
                <Mail size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
                <input
                  type="email"
                  className="input-field"
                  style={{ paddingLeft: 36 }}
                  placeholder="you@ibgctasia.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <Lock size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="input-field"
                  style={{ paddingLeft: 36, paddingRight: 40 }}
                  placeholder="Enter your password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 0,
                  }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div style={{
                background: '#FEE2E2', border: '1px solid #FECACA',
                borderRadius: 10, padding: '10px 14px',
                fontSize: 13, color: '#991B1B',
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary"
              style={{ justifyContent: 'center', padding: '12px 18px', fontSize: 15, opacity: loading ? 0.7 : 1 }}
            >
              {loading ? 'Signing in...' : 'Sign in to I-BG CT Asia IMS'}
            </button>
          </form>

          {mockMode && (
          <div style={{
            marginTop: 32, padding: 16,
            background: '#F8FAFC', borderRadius: 10,
            border: '1px solid #E2E8F0',
          }}>
            <p style={{ fontSize: 12, color: '#64748B', fontWeight: 500, marginBottom: 8 }}>
              Demo mode — Supabase not connected. Any credentials work.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[
                { role: 'Administrator', email: 'admin@ibgctasia.com', pw: 'admin123' },
                { role: 'Inv. Manager', email: 'manager@ibgctasia.com', pw: 'manager123' },
              ].map(({ role, email: e, pw }) => (
                <div key={role} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#475569' }}>
                  <span style={{ fontWeight: 600, color: '#2FA6B8' }}>{role}</span>
                  <span>{e} / {pw}</span>
                </div>
              ))}
            </div>
          </div>
          )}

          <div style={{ marginTop: 24, textAlign: 'center' }}>
            <p style={{ fontSize: 12, color: '#94A3B8' }}>
              Internal system — unauthorized access is prohibited.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
