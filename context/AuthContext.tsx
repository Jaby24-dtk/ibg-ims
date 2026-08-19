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
}

const AuthContext = createContext<AuthContextValue>({
  user: null, profile: null, loading: true,
  isMockMode: false,
})

const MOCK_PROFILE: Profile = {
  id: 'u1', name: 'Maria Santos', email: 'maria@company.com', role: 'administrator',
}

function getIsConfigured() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return url.length > 0 && !url.includes('your-project-ref')
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
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
      try {
        ;({ data: { session } } = await supabase.auth.getSession())
      } catch {
        try {
          ;({ data: { session } } = await supabase.auth.getSession())
        } catch {
          if (mounted) setLoading(false)
          return
        }
      }
      if (!mounted) return

      setUser(session?.user ?? null)
      setLoading(false)
      if (session?.user) fetchProfile(session.user.id)

      const { data } = supabase.auth.onAuthStateChange(
        async (_event, session) => {
          if (!mounted) return
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
    <AuthContext.Provider value={{ user, profile, loading, isMockMode }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
