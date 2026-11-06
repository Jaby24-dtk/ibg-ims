import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { AUTH_COOKIE_OPTIONS } from './config'

/**
 * Reads the access token from the app's renamed session cookie
 * (`sb-ims-auth-token`, plus `.0`/`.1` chunks). Supabase's server client
 * defaults to `sb-<ref>-auth-token`, so routes that didn't pass the app's
 * cookie name never found the session and 401'd every call.
 */
export function accessTokenFromCookies(req: NextRequest): string | null {
  const base = AUTH_COOKIE_OPTIONS.name
  const parts = req.cookies.getAll()
    .filter(c => c.name === base || c.name.startsWith(`${base}.`))
    .sort((a, b) => (Number(a.name.split('.').pop()) || 0) - (Number(b.name.split('.').pop()) || 0))
  if (!parts.length) return null
  const raw = parts.map(c => c.value).join('')
  try {
    const json = raw.startsWith('base64-') ? Buffer.from(raw.slice(7), 'base64url').toString('utf8') : raw
    const token = JSON.parse(json)?.access_token
    return typeof token === 'string' && token ? token : null
  } catch { return null }
}

/**
 * The signed-in user for an API request, verified against Supabase Auth.
 * Never refreshes server-side: API routes can't write the rotated cookie
 * back, so a refresh here would burn the browser's refresh token.
 */
export async function userFromRequest(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const token = accessTokenFromCookies(req)
  if (!url || !anon || !token) return null
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: { user } } = await sb.auth.getUser(token)
  return user ?? null
}
