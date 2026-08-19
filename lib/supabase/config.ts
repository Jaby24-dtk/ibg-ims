// Returns true only when real Supabase credentials are present
export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return url.length > 0 && !url.includes('your-project-ref')
}

// `SameSite=None` was added 2026-08-13 so the session cookie would survive
// being embedded as a cross-origin iframe inside STIV's Systems panel — the
// default `Lax` cookie is never sent on that cross-site subrequest.
//
// Reverted 2026-08-19: `None` is the most heavily scrutinized cookie setting
// across browsers (it's the classic third-party-tracking configuration), and
// it's been a repeat source of exactly this class of bug — Safari silently
// failed to persist it at all (fixed 2026-08-18 by dropping `partitioned`),
// and two users hit a *write-succeeds-but-reads-back-as-no-session* failure
// on it in Chrome/Edge on 2026-08-19 that no amount of navigation-timing
// fixes resolved. `Lax` is Supabase's own SDK default for good reason, and
// every navigation in this app is now a real page load rather than a
// client-side transition (see AuthGate.tsx, login/page.tsx), so `Lax` is
// fully sufficient for direct sign-in — which is the primary, must-work use
// case. This trades away the STIV iframe embed working until that's
// revisited separately; direct login reliability takes priority.
export const AUTH_COOKIE_OPTIONS = {
  sameSite: 'lax' as const,
  secure: true,
}
