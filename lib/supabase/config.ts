// Returns true only when real Supabase credentials are present
export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return url.length > 0 && !url.includes('your-project-ref')
}

// IMS is embedded as a cross-origin iframe inside STIV's Systems panel
// (the SSO bridge at app/sso). A default `SameSite=Lax` session cookie is
// never sent on that cross-site subrequest, so the embedded session looked
// signed-out even though the token hand-off itself succeeded. `SameSite=None`
// makes the cookie eligible for third-party contexts, which is what actually
// fixes the embed.
//
// `partitioned: true` (CHIPS) was added on top of that as a privacy
// hardening — scoping the cookie to the embedding site instead of it being a
// plain third-party cookie — but it's NOT required for the embed to work,
// and Safari's CHIPS support turned out to be too immature to trust: it was
// silently failing to persist the cookie even on normal, non-embedded,
// direct top-level visits (confirmed 2026-08-18 — every sign-in attempt in
// Safari succeeded against Supabase but the resulting session cookie never
// reached the next request, so middleware saw no user and bounced straight
// back to /login — an infinite "stuck signing in" loop). Dropped
// `partitioned` to restore normal Safari compatibility; the STIV iframe
// embed only ever needed `SameSite=None; Secure`.
export const AUTH_COOKIE_OPTIONS = {
  sameSite: 'none' as const,
  secure: true,
}
