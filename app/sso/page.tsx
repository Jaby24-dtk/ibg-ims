'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// SSO bridge landing page — reached only from STIV's Systems panel. STIV
// mints a live Supabase session for the current user (via its own
// server-side call using credentials it holds) and hands the access/refresh
// token pair here as a URL fragment, which browsers never send to any
// server. This page's only job is to pick those up and establish the same
// session locally via setSession(), then hand off to the normal app.
export default function SsoBridgePage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
    const params = new URLSearchParams(hash)
    const access_token = params.get('access_token')
    const refresh_token = params.get('refresh_token')

    if (!access_token || !refresh_token) {
      setError('Missing sign-in tokens.')
      return
    }

    const supabase = createClient()
    supabase.auth.setSession({ access_token, refresh_token }).then(({ error: sessionError }) => {
      if (sessionError) {
        setError(sessionError.message)
        return
      }
      // Clear the tokens from the URL before navigating away.
      window.history.replaceState({}, '', '/sso')
      router.replace('/dashboard')
    })
  }, [router])

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      {error ? (
        <div style={{ textAlign: 'center', color: '#B91C1C' }}>
          <p>Sign-in failed: {error}</p>
          <a href="/login" style={{ color: '#0F172A', textDecoration: 'underline' }}>Go to login</a>
        </div>
      ) : (
        <p style={{ color: '#64748B' }}>Signing you in…</p>
      )}
    </div>
  )
}
