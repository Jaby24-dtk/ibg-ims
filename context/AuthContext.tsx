'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { User } from '@supabase/supabase-js'
import type { UserRole } from '@/types'
import { createClient } from '@/lib/supabase/client'

export interface Profile {
  id: string
  name: string
  email: string
  role: UserRole
}

interface AuthContextValue {
  user: User | null
  profile: Profile | null
  loading: boolean
  isMockMode: boolean
  // TEMP DIAGNOSTIC (2026-08-19): what the client-side session check actually
  // saw, surfaced by AuthGate when user ends up null. Remove alongside the
  // debug panel in AuthGate.tsx once root-caused.
  authDebug: string | null
}

const AuthContext = createContext<AuthContextValue>({
  user: null, profile: null, loading: true,
  isMockMode: false, authDebug: null,
})

const MOCK_PROFILE: Profile = {
  id: 'u1', name: 'Maria Santos', email: 'maria@company.com', role: 'administrator',
}

function getIsConfigured() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return url.length > 0 && !url.includes('your-project-ref')
}

// TEMP DIAGNOSTIC (2026-08-19): replicates @supabase/ssr's own cookie decode
// (base64url -> JSON.parse) directly against the live document.cookie value,
// so we see exactly where it breaks instead of just "session: null". Remove
// alongside the rest of this diagnostic once root-caused.
function manuallyDecodeAuthCookie(): string {
  const cookies = document.cookie.split('; ').filter(c => /^sb-.*-auth-token(\.\d+)?=/.test(c))
  if (cookies.length === 0) return 'no sb-*-auth-token cookie found in document.cookie'

  const parts: string[] = [`found ${cookies.length} matching cookie(s): ${cookies.map(c => c.split('=')[0]).join(', ')}`]
  const raw = cookies.map(c => c.slice(c.indexOf('=') + 1)).join('')
  parts.push(`combined raw value length: ${raw.length} chars`)

  if (!raw.startsWith('base64-')) {
    parts.push('does not start with "base64-" prefix — treating as raw JSON')
    try { JSON.parse(raw); parts.push('JSON.parse succeeded on raw value') }
    catch (e) { parts.push(`JSON.parse FAILED on raw value: ${String(e)}`) }
    return parts.join('\n')
  }

  try {
    const b64 = raw.slice(7).replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
    const decoded = new TextDecoder('utf-8').decode(bytes)
    parts.push(`base64url decode OK, decoded length: ${decoded.length} chars`)
    try {
      const parsed = JSON.parse(decoded)
      parts.push(`JSON.parse OK. keys: ${Object.keys(parsed).join(', ')}`)
      parts.push(`expires_at: ${parsed.expires_at} (${parsed.expires_at ? new Date(parsed.expires_at * 1000).toISOString() : 'n/a'}), now: ${new Date().toISOString()}`)
    } catch (e) {
      parts.push(`JSON.parse FAILED on decoded value: ${String(e)}`)
      parts.push(`decoded value (first 300 chars): ${decoded.slice(0, 300)}`)
    }
  } catch (e) {
    parts.push(`base64url decode FAILED: ${String(e)}`)
  }
  return parts.join('\n')
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [authDebug, setAuthDebug] = useState<string | null>(null)
  const isMockMode = !getIsConfigured()

  const fetchProfile = useCallback(async (userId: string) => {
    try {
      const supabase = createClient()
      const { data } = await supabase
        .from('users')
        .select('id, name, email, role')
        .eq('id', userId)
        .single()
      if (data) setProfile(data as Profile)
    } catch {
      // profile table may not exist yet
    }
  }, [])

  useEffect(() => {
    if (isMockMode) {
      setProfile(MOCK_PROFILE)
      setLoading(false)
      return
    }

    let mounted = true
    let subscription: { unsubscribe: () => void } | null = null

    ;(async () => {
      const supabase = createClient()

      // One retry on a thrown error before giving up: a throw here means the
      // call itself failed (a dropped request, a momentary Supabase hiccup),
      // not that the session is actually invalid — getSession() resolves
      // normally with session: null for that case. Bailing out on the first
      // failure was signing perfectly valid sessions out over transient blips.
      let session
      let getSessionError: unknown = null
      try {
        ;({ data: { session } } = await supabase.auth.getSession())
      } catch (err) {
        getSessionError = err
        try {
          ;({ data: { session } } = await supabase.auth.getSession())
          getSessionError = null
        } catch (err2) {
          getSessionError = err2
          if (mounted) {
            setAuthDebug(
              `getSession() threw twice.\nerror: ${String(err2)}\n\ndocument.cookie:\n${document.cookie || '(empty)'}`
            )
            setLoading(false)
          }
          return
        }
      }
      if (!mounted) return

      // TEMP DIAGNOSTIC (2026-08-19): remove alongside AuthGate's debug panel.
      setAuthDebug(
        `getSession() on mount:\n` +
        `session present: ${!!session}\n` +
        `user present: ${!!session?.user}\n` +
        `expires_at: ${session?.expires_at ?? '(none)'} (${session?.expires_at ? new Date(session.expires_at * 1000).toISOString() : 'n/a'})\n` +
        `now: ${new Date().toISOString()}\n` +
        `getSessionError: ${getSessionError ? String(getSessionError) : '(none)'}\n\n` +
        `manual cookie decode:\n${manuallyDecodeAuthCookie()}`
      )

      setUser(session?.user ?? null)
      setLoading(false)
      if (session?.user) fetchProfile(session.user.id)

      const { data } = supabase.auth.onAuthStateChange(
        async (event, session) => {
          if (!mounted) return
          // TEMP DIAGNOSTIC: only overwrite the debug panel when this event is
          // the one leaving user null, so the login-time snapshot above isn't
          // lost if this fires with a valid session right after mount.
          if (!session?.user) {
            setAuthDebug(
              `onAuthStateChange fired:\n` +
              `event: ${event}\n` +
              `session present: ${!!session}\n\n` +
              `manual cookie decode:\n${manuallyDecodeAuthCookie()}`
            )
          }
          setUser(session?.user ?? null)
          if (session?.user) {
            fetchProfile(session.user.id)
          } else {
            setProfile(null)
          }
        }
      )
      subscription = data.subscription
    })()

    return () => { mounted = false; subscription?.unsubscribe() }
  }, [isMockMode, fetchProfile])

  return (
    <AuthContext.Provider value={{ user, profile, loading, isMockMode, authDebug }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
