'use client'

import { useState, useEffect } from 'react'

export type UserRole = 'administrator' | 'inventory_manager' | 'staff' | 'viewer' | null

const configured = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return url.length > 0 && !url.includes('your-project-ref')
})()

export function useRole(): UserRole {
  // When Supabase is not configured (local dev), default to admin so nothing is locked out
  const [role, setRole] = useState<UserRole>(configured ? null : 'administrator')

  useEffect(() => {
    if (!configured) return
    async function load() {
      try {
        const { createClient } = await import('@/lib/supabase/client')
        const sb = createClient()
        const { data: { user } } = await sb.auth.getUser()
        if (!user) { setRole('viewer'); return }
        const { data } = await sb.from('users').select('role').eq('id', user.id).single()
        setRole((data?.role as UserRole) ?? 'viewer')
      } catch {
        setRole('viewer')
      }
    }
    load()
  }, [])

  return role
}

export function canExport(role: UserRole) {
  return role === 'administrator' || role === 'inventory_manager' || role === 'staff'
}

export function canEdit(role: UserRole) {
  return role === 'administrator' || role === 'inventory_manager'
}

export function isAdmin(role: UserRole) {
  return role === 'administrator'
}
