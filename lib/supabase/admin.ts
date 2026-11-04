import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

// Service-role client for server-only code (e.g. the notifications email route). Bypasses RLS —
// never import this from a client component.
let admin: SupabaseClient | null = null

export function createAdminClient(): SupabaseClient {
  if (admin) return admin
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase service role not configured')
  admin = createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  return admin
}
