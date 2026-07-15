// Returns true only when real Supabase credentials are present
export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return url.length > 0 && !url.includes('your-project-ref')
}

// IMS is embedded as a cross-origin iframe inside STIV's Systems panel
// (the SSO bridge at app/sso). A default `SameSite=Lax` session cookie is
// never sent on that cross-site subrequest, so the embedded session looked
// signed-out even though the token hand-off itself succeeded. `SameSite=None`
// makes the cookie eligible for third-party contexts; `Partitioned` (CHIPS)
// keeps it scoped to the embedding top-level site instead of becoming a
// bare third-party cookie, so this doesn't hand out a broader session than
// before — same auth cookie, now readable from within the STIV embed too.
export const AUTH_COOKIE_OPTIONS = {
  sameSite: 'none' as const,
  secure: true,
  partitioned: true,
}
