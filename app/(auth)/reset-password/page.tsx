'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Eye, EyeOff, Lock } from 'lucide-react'

type Stage = 'verifying' | 'ready' | 'invalid' | 'done'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [stage, setStage] = useState<Stage>('verifying')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // The reset email can land here three ways depending on the Supabase
  // auth flow / email template: ?code= (PKCE), ?token_hash=&type=recovery,
  // or #access_token= (implicit, picked up by the client automatically).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      const tokenHash = params.get('token_hash')

      let ok = false
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        ok = !error
      } else if (tokenHash) {
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
        ok = !error
      } else {
        const { data: { session } } = await supabase.auth.getSession()
        ok = !!session
      }
      if (cancelled) return
      // Strip the one-time token from the address bar.
      window.history.replaceState(null, '', '/reset-password')
      setStage(ok ? 'ready' : 'invalid')
    })()
    return () => { cancelled = true }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }

    setLoading(true)
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        setError(updateError.message)
        setLoading(false)
        return
      }
      setStage('done')
      setTimeout(() => { router.push('/dashboard'); router.refresh() }, 1500)
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #0d3e4b 100%)',
      padding: 16,
    }}>
      <div style={{ width: '100%', maxWidth: 420, background: 'white', borderRadius: 16, padding: 36 }}>
        <Image
          src="/ibg-mark.png"
          alt="I-BG CT Asia"
          width={72}
          height={71}
          unoptimized
          style={{ width: 72, height: 'auto', marginBottom: 20 }}
          priority
        />

        {stage === 'verifying' && (
          <p style={{ color: '#64748B', fontSize: 14 }}>Verifying your reset link…</p>
        )}

        {stage === 'invalid' && (
          <>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>Link expired or invalid</h2>
            <p style={{ color: '#64748B', fontSize: 14, marginBottom: 20, lineHeight: 1.5 }}>
              This password reset link has expired or was already used. Request a new one from the sign-in page
              (open it in the same browser you requested it from).
            </p>
            <button className="btn-primary" style={{ justifyContent: 'center', padding: '12px 18px', fontSize: 15, width: '100%' }} onClick={() => router.push('/login')}>
              Back to sign in
            </button>
          </>
        )}

        {stage === 'done' && (
          <>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>Password updated</h2>
            <p style={{ color: '#64748B', fontSize: 14 }}>Taking you to your dashboard…</p>
          </>
        )}

        {stage === 'ready' && (
          <>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>Set a new password</h2>
            <p style={{ color: '#64748B', fontSize: 14, marginBottom: 24 }}>At least 8 characters.</p>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {[
                { label: 'New password', value: password, set: setPassword },
                { label: 'Confirm new password', value: confirm, set: setConfirm },
              ].map(({ label, value, set }, i) => (
                <div key={label}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                    {label}
                  </label>
                  <div style={{ position: 'relative' }}>
                    <Lock size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      className="input-field"
                      style={{ paddingLeft: 36, paddingRight: 40 }}
                      value={value}
                      onChange={e => set(e.target.value)}
                      autoComplete="new-password"
                      autoFocus={i === 0}
                      required
                    />
                    {i === 0 && (
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
                    )}
                  </div>
                </div>
              ))}

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
                {loading ? 'Saving...' : 'Update password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
