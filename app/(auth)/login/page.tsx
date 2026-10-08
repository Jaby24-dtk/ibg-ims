'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Manrope } from 'next/font/google'

const manrope = Manrope({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--ib-font' })

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

// Ported from the provided "ibg-ultra-premium" design (index.html), scoped under ib-.
// Manrope is self-hosted via next/font (no runtime call to Google Fonts).
const LOGIN_CSS = `
.ib-layout{min-height:100svh;display:grid;grid-template-columns:minmax(0,1.62fr) minmax(380px,.88fr);font-family:var(--ib-font),Manrope,Inter,system-ui,Arial,sans-serif;background:#06111c;color:#fff;width:100%}
.ib-layout *{box-sizing:border-box}
.ib-layout button,.ib-layout input{font:inherit}
.ib-layout button{cursor:pointer}
.ib-layout button:focus-visible,.ib-layout input:focus-visible{outline:3px solid #67dfe8;outline-offset:3px}
.ib-hero{position:relative;isolation:isolate;overflow:hidden;min-height:820px;padding:clamp(35px,5vw,78px);display:flex;flex-direction:column;justify-content:space-between;background:radial-gradient(ellipse at 83% 50%,#0d3e4b 0%,#0b2232 38%,#06101b 76%)}
.ib-hero:before{content:"";position:absolute;inset:0;z-index:-2;background:linear-gradient(90deg,#06101b 2%,rgba(6,16,27,.91) 42%,rgba(6,16,27,.15) 100%),url('/login-warehouse-v2.jpg') 62% center/cover no-repeat;opacity:.7}
.ib-hero:after{content:"";position:absolute;inset:0;z-index:-1;background:radial-gradient(circle at 80% 60%,transparent 8%,rgba(3,13,24,.55) 72%);pointer-events:none}
.ib-mesh{position:absolute;inset:0;opacity:.13;background-image:linear-gradient(#4de4ec22 1px,transparent 1px),linear-gradient(90deg,#4de4ec22 1px,transparent 1px);background-size:58px 58px;-webkit-mask-image:linear-gradient(90deg,transparent,#000);mask-image:linear-gradient(90deg,transparent,#000);pointer-events:none}
.ib-orb{position:absolute;width:440px;height:440px;right:-120px;top:18%;border-radius:50%;background:#20c8e4;filter:blur(140px);opacity:.12;animation:ibBreathe 7s ease-in-out infinite alternate}
.ib-brand{display:flex;align-items:center;gap:15px;position:relative;z-index:2}
.ib-logo-circle{width:104px;height:104px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 10px 30px rgba(0,0,0,.35),0 0 0 4px rgba(77,228,236,.14)}
.ib-logo{width:76px;height:76px;object-fit:contain}
.ib-brand-label{display:flex;flex-direction:column;gap:6px;text-transform:uppercase}
.ib-brand-name{font-size:30px;font-weight:800;letter-spacing:.08em;color:#fff;line-height:1}
.ib-brand-sub{font-size:13px;font-weight:700;letter-spacing:.24em;color:#3bd2e2;line-height:1.3}
.ib-content{position:relative;z-index:2;max-width:620px;padding:65px 0 45px}
.ib-eyebrow{display:inline-flex;align-items:center;gap:10px;border:1px solid #54dbe744;border-radius:100px;padding:9px 15px;color:#b9edf0;font-size:10px;letter-spacing:.19em;font-weight:700}
.ib-dot{width:6px;height:6px;background:#38d5e4;border-radius:50%;box-shadow:0 0 14px #36dce8}
.ib-hero h1{font-size:clamp(46px,4.5vw,78px);line-height:1.08;letter-spacing:-.065em;margin:27px 0 24px;font-weight:800;color:#fff}
.ib-hero h1 span{display:block;color:#3bd2e2}
.ib-desc{max-width:450px;color:#b0c2d0;font-size:15px;line-height:1.85;margin:0 0 42px}
.ib-features{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;max-width:630px}
.ib-feature{padding:21px 17px;border:1px solid #8eeaf124;border-radius:16px;background:linear-gradient(140deg,#18374891,#071724a8);backdrop-filter:blur(16px);transition:transform .3s,border-color .3s}
.ib-feature:hover{transform:translateY(-6px);border-color:#6adfea88}
.ib-feature svg{width:24px;height:24px;color:#48d6e3;margin-bottom:16px}
.ib-feature b{display:block;font-size:12px;margin-bottom:7px}
.ib-feature small{font-size:10px;color:#91aaba;line-height:1.6;display:block}
.ib-footer{color:#7996a7;font-size:11px;position:relative;z-index:2}
.ib-analytics{position:absolute;right:3.5%;top:20%;width:220px;display:grid;gap:13px;z-index:1;pointer-events:none}
.ib-stat{background:linear-gradient(130deg,#0b2a3ecb,#061a29cf);border:1px solid #71e3ec44;box-shadow:0 20px 65px #0005,inset 0 1px #ffffff15;backdrop-filter:blur(18px);border-radius:16px;padding:17px 20px;animation:ibFloat 6s ease-in-out infinite}
.ib-stat:nth-child(2){animation-delay:-2s}
.ib-stat:nth-child(3){animation-delay:-4s}
.ib-stat .ib-label{font-size:11px;color:#a8cad6}
.ib-stat strong{font-size:29px;letter-spacing:-.04em;display:block;margin:5px 0}
.ib-stat small{font-size:10px;color:#87a4b3}
.ib-stat strong em{font-style:normal;color:#43d7e6}
.ib-line{height:4px;background:#174451;border-radius:4px;overflow:hidden;margin-top:13px}
.ib-line i{display:block;background:linear-gradient(90deg,#0d9ba9,#5af1f5);height:100%;width:98%;border-radius:4px;animation:ibGrow 2s ease-out}
.ib-login-side{position:relative;background:linear-gradient(145deg,#eaf4f8,#f9fcfe 60%,#e5f2f7);color:#122030;display:flex;align-items:center;justify-content:center;padding:60px 34px;overflow:hidden}
.ib-login-side:before{content:"";position:absolute;width:700px;height:700px;border:1px solid #bbd9e4;border-radius:100px;transform:rotate(34deg);top:-530px;right:-300px}
.ib-panel{position:relative;width:100%;max-width:440px;background:#ffffffed;border:1px solid #fff;box-shadow:0 30px 90px #173d501e,0 3px 15px #183e4b0b;border-radius:27px;padding:clamp(27px,3.2vw,48px);animation:ibArrive .9s both}
.ib-panel-logo-circle{width:128px;height:128px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;border:1px solid #dce9ef;box-shadow:0 12px 30px #173d5018}
.ib-panel-logo{width:94px;height:94px;object-fit:contain}
.ib-panel h2{font-size:32px;letter-spacing:-.05em;margin:15px 0 7px;font-weight:800;color:#122030}
.ib-sub{font-size:12px;color:#718399;line-height:1.7;margin:0 0 29px}
.ib-field-head{display:flex;justify-content:space-between;align-items:center;margin:0 0 9px}
.ib-field-head label{font-size:12px;font-weight:700}
.ib-forgot{border:0;background:none;color:#078fa2;font-size:11px;padding:0}
.ib-field{position:relative;margin-bottom:23px}
.ib-field input{width:100%;height:51px;border:1px solid #dce5ec;border-radius:11px;background:#f9fcfe;padding:0 64px 0 15px;font-size:13px;color:#122030;transition:border-color .2s,box-shadow .2s}
.ib-field input:focus{border-color:#23b9c9;box-shadow:0 0 0 4px #25c6d514;outline:none}
.ib-eye{position:absolute;right:10px;top:8px;border:0;background:transparent;color:#6d8799;padding:9px;font-size:12px}
.ib-submit{width:100%;height:52px;border:0;border-radius:11px;background:linear-gradient(110deg,#075f70,#0ca6b5 55%,#38d6dc);color:#fff;font-weight:800;font-size:13px;box-shadow:0 9px 20px #0ba4b22d;transition:transform .2s,box-shadow .2s}
.ib-submit:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 12px 27px #0ba4b24d}
.ib-submit:disabled{opacity:.65;cursor:not-allowed}
.ib-ghost{width:100%;margin-top:12px;border:0;background:none;color:#078fa2;font-size:12px;font-weight:700;padding:6px}
.ib-status{min-height:20px;color:#a24a32;font-size:11px;margin-top:12px}
.ib-success{background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;border-radius:11px;padding:14px;font-size:12px;line-height:1.6;margin-bottom:16px}
.ib-demo{background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:10px;padding:10px 12px;font-size:11px;margin-top:16px;text-align:center}
.ib-note{font-size:10px;color:#91a3b4;text-align:center;margin-top:24px}
@keyframes ibFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-11px)}}
@keyframes ibBreathe{to{opacity:.23;transform:scale(1.2)}}
@keyframes ibGrow{from{width:0}}
@keyframes ibArrive{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:1160px){.ib-analytics{opacity:.65;right:1%;width:175px}.ib-content{max-width:480px}.ib-hero h1{font-size:55px}}
@media(max-width:880px){.ib-layout{grid-template-columns:1fr}.ib-hero{min-height:650px;padding:35px}.ib-content{padding:65px 0}.ib-analytics{right:4%;top:22%}.ib-login-side{padding:70px 22px}.ib-panel{max-width:490px}.ib-hero .ib-features{max-width:550px}}
@media(max-width:600px){.ib-hero{min-height:590px;padding:27px}.ib-logo-circle{width:78px;height:78px}.ib-logo{width:56px;height:56px}.ib-brand-name{font-size:22px}.ib-brand-sub{font-size:10px;letter-spacing:.18em}.ib-content{padding:42px 0 25px}.ib-hero h1{font-size:clamp(40px,10vw,55px)}.ib-analytics{display:none}.ib-features{gap:8px}.ib-feature{padding:14px 10px}.ib-feature b{font-size:10px}.ib-feature small{font-size:9px}.ib-feature svg{width:20px;height:20px}.ib-login-side{padding:45px 15px}.ib-panel{padding:28px 22px}}
@media(prefers-reduced-motion:reduce){.ib-layout *,.ib-layout *:before,.ib-layout *:after{animation:none!important;transition:none!important}}
`

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lockedFor, setLockedFor] = useState(0)
  const [forgotMode, setForgotMode] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const mockMode = !isSupabaseConfigured()

  useEffect(() => {
    setLockedFor(minutesLocked())
  }, [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const mins = minutesLocked()
    if (mins > 0) {
      setLockedFor(mins)
      setError(`Too many failed attempts. Try again in ${mins} minute${mins !== 1 ? 's' : ''}.`)
      return
    }

    setLoading(true)

    if (mockMode) {
      await new Promise(r => setTimeout(r, 600))
      router.push('/dashboard')
      return
    }

    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      // Clear any stale local session first so a leftover invalid refresh-token
      // cookie can't interfere with the new sign-in.
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
      // Never let the button hang forever on a stalled network call.
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), 15000)
      )
      const { error: authError } = await Promise.race([
        supabase.auth.signInWithPassword({ email, password }),
        timeout,
      ])
      if (authError) {
        recordFail()
        const remaining = MAX_ATTEMPTS - getAttempts().count
        const locked = minutesLocked()
        if (locked > 0) {
          setLockedFor(locked)
          setError(`Too many failed attempts. Try again in ${locked} minute${locked !== 1 ? 's' : ''}.`)
        } else {
          setError(
            authError.message === 'Invalid login credentials'
              ? `Incorrect email or password. ${remaining > 0 ? `${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.` : ''}`
              : authError.message
          )
        }
        setLoading(false)
      } else {
        resetAttempts()
        // A hard navigation, not router.push(): guarantees middleware reads
        // the cookie that signInWithPassword() just wrote, rather than racing
        // a client-side transition against that write.
        window.location.href = '/dashboard'
      }
    } catch (err) {
      setError(
        err instanceof Error && err.message === 'TIMEOUT'
          ? 'Sign-in is taking too long. Check your connection and try again.'
          : 'Something went wrong. Please try again.'
      )
      setLoading(false)
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    if (mockMode) {
      await new Promise(r => setTimeout(r, 600))
      setResetSent(true)
      setLoading(false)
      return
    }
    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      // Supabase returns success for unknown emails too; only surface
      // real failures (e.g. rate limits) so the form can't be used to
      // probe which addresses have accounts.
      if (resetError) setError(resetError.message)
      else setResetSent(true)
    } catch {
      setError('Something went wrong. Please try again.')
    }
    setLoading(false)
  }

  function switchMode(forgot: boolean) {
    setForgotMode(forgot)
    setResetSent(false)
    setError('')
  }

  return (
    <main className={`ib-layout ${manrope.variable}`}>
      <style>{LOGIN_CSS}</style>
      <section className="ib-hero">
        <div className="ib-mesh" />
        <div className="ib-orb" />
        <header className="ib-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <div className="ib-logo-circle"><img className="ib-logo" src="/ibg-logo-mark.png" alt="I-BG CT Asia logo" /></div>
          <div className="ib-brand-label"><span className="ib-brand-name">IBG Group</span><span className="ib-brand-sub">Inventory Management System</span></div>
        </header>
        <div className="ib-analytics" aria-hidden="true">
          <div className="ib-stat"><div className="ib-label">◈ Inventory health</div><strong><em>98%</em></strong><small>Illustrative dashboard preview</small><div className="ib-line"><i /></div></div>
          <div className="ib-stat"><div className="ib-label">△ Low stock items</div><strong>03 <small>items</small></strong><small>Inventory visibility</small></div>
          <div className="ib-stat"><div className="ib-label">▦ Expiry alerts</div><strong>12 <small>items</small></strong><small>Proactive monitoring</small></div>
        </div>
        <div className="ib-content">
          <div className="ib-eyebrow"><span className="ib-dot" /> INTELLIGENT INVENTORY CONTROL</div>
          <h1>Smarter<br />Inventory.<span>Stronger<br />Operations.</span></h1>
          <p className="ib-desc">One secure command center for inventory, purchase orders, suppliers and stock performance — designed for clarity, control and confidence.</p>
          <div className="ib-features">
            <div className="ib-feature">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m12 2 9 5-9 5-9-5 9-5Zm-9 5v10l9 5 9-5V7M12 12v10" /></svg>
              <b>Stock Tracking</b><small>Clear visibility across every product</small>
            </div>
            <div className="ib-feature">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="5" y="2" width="14" height="20" rx="2" /><path d="M8 7h8M8 11h8M8 15h5" /></svg>
              <b>Purchase Orders</b><small>Suppliers and restocking, simplified</small>
            </div>
            <div className="ib-feature">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 20h18M6 17v-5h3v5M11 17V7h3v10M16 17V3h3v14" /></svg>
              <b>Real-time Insights</b><small>Performance, stock and expiry trends</small>
            </div>
          </div>
        </div>
        <footer className="ib-footer">© {new Date().getFullYear()} I-BG CT Asia Pte. Ltd. · Internal use only</footer>
      </section>

      <section className="ib-login-side">
        <div className="ib-panel">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <div className="ib-panel-logo-circle"><img src="/ibg-logo-mark.png" alt="I-BG CT Asia logo" className="ib-panel-logo" /></div>
          <h2>{forgotMode ? 'Reset password.' : 'Welcome back.'}</h2>
          <p className="ib-sub">
            {forgotMode
              ? 'Enter your company email and we\'ll send you a link to set a new password.'
              : 'Sign in with your company credentials to access the I-BG CT Asia Inventory Management System.'}
          </p>

          {forgotMode ? (
            resetSent ? (
              <>
                <div className="ib-success">
                  If an account exists for <strong>{email.trim()}</strong>, a password reset link is on its way.
                  Check your inbox (and spam folder). The link expires in 1 hour.
                </div>
                <button type="button" className="ib-submit" onClick={() => switchMode(false)}>Back to sign in</button>
              </>
            ) : (
              <form method="post" onSubmit={handleForgot}>
                <div className="ib-field-head"><label htmlFor="email">Email address</label></div>
                <div className="ib-field">
                  <input id="email" type="email" autoComplete="username" placeholder="you@ibgctasia.com" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
                </div>
                <button type="submit" className="ib-submit" disabled={loading}>{loading ? 'Sending…' : 'Send reset link →'}</button>
                <button type="button" className="ib-ghost" onClick={() => switchMode(false)}>← Back to sign in</button>
                <div className="ib-status" role="status" aria-live="polite">{error}</div>
              </form>
            )
          ) : (
            <form method="post" onSubmit={handleLogin}>
              <div className="ib-field-head"><label htmlFor="email">Email address</label></div>
              <div className="ib-field">
                <input id="email" type="email" autoComplete="username" placeholder="you@ibgctasia.com" value={email} onChange={e => setEmail(e.target.value)} required />
              </div>
              <div className="ib-field-head">
                <label htmlFor="password">Password</label>
                <button type="button" className="ib-forgot" onClick={() => switchMode(true)}>Forgot password?</button>
              </div>
              <div className="ib-field">
                <input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={e => setPassword(e.target.value)} required />
                <button className="ib-eye" type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <button className="ib-submit" type="submit" disabled={loading || lockedFor > 0}>
                {loading ? 'Signing in…' : lockedFor > 0 ? `Locked — try in ${lockedFor}m` : 'Sign in securely →'}
              </button>
              <div className="ib-status" role="status" aria-live="polite">{error}</div>
            </form>
          )}

          {mockMode && (
            <div className="ib-demo">Demo mode — Supabase not connected. Any credentials work.</div>
          )}

          <div className="ib-note">♧ Secure portal · Authorized personnel only</div>
        </div>
      </section>
    </main>
  )
}
