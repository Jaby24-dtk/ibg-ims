'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Eye, EyeOff, Lock, Mail } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

function isSupabaseConfigured() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return url.length > 0 && !url.includes('your-project-ref')
}

const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 15 * 60 * 1000
function getAttempts(): { count: number; lockedUntil: number } {
  try {
    const d = sessionStorage.getItem('_lka')
    return d ? JSON.parse(d) : { count: 0, lockedUntil: 0 }
  } catch { return { count: 0, lockedUntil: 0 } }
}
function recordFail() {
  const a = getAttempts()
  a.count++
  if (a.count >= MAX_ATTEMPTS) a.lockedUntil = Date.now() + LOCKOUT_MS
  sessionStorage.setItem('_lka', JSON.stringify(a))
}
function resetAttempts() { sessionStorage.removeItem('_lka') }
function minutesLocked(): number {
  const a = getAttempts()
  return (a.lockedUntil && Date.now() < a.lockedUntil) ? Math.ceil((a.lockedUntil - Date.now()) / 60000) : 0
}

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lockedFor, setLockedFor] = useState(0)
  const mockMode = !isSupabaseConfigured()

  useEffect(() => {
    const mins = minutesLocked()
    if (mins > 0) {
      setLockedFor(mins)
      const t = setInterval(() => {
        const m = minutesLocked()
        setLockedFor(m)
        if (m === 0) clearInterval(t)
      }, 30000)
      return () => clearInterval(t)
    }
  }, [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const locked = minutesLocked()
    if (locked > 0) {
      setLockedFor(locked)
      setError(`Too many failed attempts. Try again in ${locked} minute${locked > 1 ? 's' : ''}.`)
      return
    }

    setLoading(true)

    if (mockMode) {
      await new Promise(r => setTimeout(r, 600))
      router.push('/dashboard')
      return
    }

    try {
      const supabase = createClient()
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
      if (authError) {
        recordFail()
        const mins = minutesLocked()
        if (mins > 0) {
          setLockedFor(mins)
          setError(`Too many failed attempts. Try again in ${mins} minute${mins > 1 ? 's' : ''}.`)
        } else {
          setError(authError.message === 'Invalid login credentials'
            ? 'Incorrect email or password. Please try again.'
            : authError.message)
        }
        setLoading(false)
      } else {
        resetAttempts()
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
              disabled={loading || lockedFor > 0}
              className="btn-primary"
              style={{ justifyContent: 'center', padding: '12px 18px', fontSize: 15, opacity: (loading || lockedFor > 0) ? 0.7 : 1 }}
            >
              {loading ? 'Signing in...' : lockedFor > 0 ? `Locked — try in ${lockedFor}m` : 'Sign in to I-BG CT Asia IMS'}
            </button>
          </form>

          {mockMode && (
          <div style={{
            marginTop: 32, padding: 16,
            background: '#F8FAFC', borderRadius: 10,
            border: '1px solid #E2E8F0',
          }}>
            <p style={{ fontSize: 12, color: '#64748B', fontWeight: 500 }}>
              Demo mode — Supabase not connected. Any credentials work.
            </p>
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
