import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

function base64UrlDecode(str: string): string {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
  return new TextDecoder('utf-8').decode(bytes)
}

// Reads the Supabase session straight out of the request cookie and checks
// its own embedded `expires_at` — no call to Supabase's Auth API at all.
//
// Every previous version of this check (getSession(), then getUser()) called
// Supabase's servers on every single request. That's what caused the entire
// chain of bugs today: a client/server refresh race tripped a request-rate
// spike, which got Supabase's Auth API rate-limited (confirmed via runtime
// logs: `over_request_rate_limit`, 429), after which even *fresh, successful*
// sign-ins kept bouncing back to /login — the cookie was correct the whole
// time, but middleware's own validation call to Supabase was failing. A
// getUser()-only call also isn't reliably refresh-free in practice: "Invalid
// Refresh Token" errors kept firing from middleware on plain /login loads
// with no sign-in attempt at all, which shouldn't be possible if getUser()
// truly never touches the refresh token — something in the server client's
// own session hydration was attempting one anyway.
//
// Middleware's job here is a UX redirect, not the actual security boundary —
// real data access is authorized by Supabase's RLS policies using the JWT on
// each query, independent of this check. So there's nothing lost by making
// this purely local: read the cookie, check the token hasn't expired by its
// own embedded timestamp, done. No network call means no rate limit exposure
// and no dependency on Supabase's Auth API being healthy just to view a page.
function isSessionValid(request: NextRequest): boolean {
  const authCookies = request.cookies
    .getAll()
    .filter(c => /^sb-.*-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => {
      const an = a.name.match(/\.(\d+)$/)
      const bn = b.name.match(/\.(\d+)$/)
      if (!an && !bn) return 0
      if (!an) return -1
      if (!bn) return 1
      return Number(an[1]) - Number(bn[1])
    })

  if (authCookies.length === 0) return false

  const raw = authCookies.map(c => c.value).join('')
  const jsonStr = raw.startsWith('base64-') ? base64UrlDecode(raw.slice(7)) : raw

  try {
    const session = JSON.parse(jsonStr)
    const expiresAt = session?.expires_at
    return typeof expiresAt === 'number' && expiresAt * 1000 > Date.now()
  } catch {
    return false
  }
}

// One-time cleanup for sessions established before 2026-08-19 (when the
// cookie's SameSite attribute changed from 'none' to 'lax'). Verified live
// in a real browser: Chrome stores a SameSite=None cookie and a SameSite=Lax
// cookie of the *identical* name/domain/path as two genuinely separate
// entries — not the RFC 6265 (name, domain, path) identity the spec
// describes. A plain client-side overwrite with the new SameSite only ever
// touches the Lax slot, so the old None-scoped cookie (holding a dead
// session from before this change) keeps coexisting and — because it's
// evidently read first — permanently shadows every fresh sign-in from then
// on. document.cookie deletion, cookieStore.delete(), and cookieStore.set()
// with a past expiry from the client were all tried live and NONE of them
// could remove the None-scoped slot, even across a full reload. An actual
// HTTP Set-Cookie response header (the canonical deletion mechanism) is the
// one lever left untried, so middleware sends it here on every response,
// targeting only the SameSite=None variant of the cookie name — the current
// SameSite=Lax session cookie isn't touched.
function clearLegacySameSiteNoneCookie(response: NextResponse, supabaseUrl: string) {
  try {
    const ref = new URL(supabaseUrl).hostname.split('.')[0]
    response.cookies.set(`sb-${ref}-auth-token`, '', {
      path: '/', maxAge: 0, sameSite: 'none', secure: true,
    })
  } catch {
    // malformed supabaseUrl — nothing to clear
  }
}

export function middleware(request: NextRequest) {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    "font-src 'self' data: https://fonts.gstatic.com",
    "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "frame-ancestors 'self' https://command.iamstivai.com",
  ].join('; ')

  const response = NextResponse.next()
  response.headers.set('Content-Security-Policy', csp)

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const configured = supabaseUrl.length > 0 && !supabaseUrl.includes('your-project-ref')
  if (!configured) return response

  clearLegacySameSiteNoneCookie(response, supabaseUrl)

  const authed = isSessionValid(request)
  const { pathname } = request.nextUrl
  const isLoginPage = pathname === '/login'
  const isRoot = pathname === '/'
  // The STIV SSO bridge lands here unauthenticated — it establishes the
  // session client-side via setSession() using tokens minted by STIV, so it
  // must be reachable before a session cookie exists.
  const isSsoBridge = pathname === '/sso'

  if (!authed && !isLoginPage && !isRoot && !isSsoBridge) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    const redirectRes = NextResponse.redirect(url)
    clearLegacySameSiteNoneCookie(redirectRes, supabaseUrl)
    return redirectRes
  }

  if (authed && isLoginPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    const redirectRes = NextResponse.redirect(url)
    clearLegacySameSiteNoneCookie(redirectRes, supabaseUrl)
    return redirectRes
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
