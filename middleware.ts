import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { AUTH_COOKIE_OPTIONS } from './lib/supabase/config'

export async function middleware(request: NextRequest) {
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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  const configured = supabaseUrl.length > 0 && !supabaseUrl.includes('your-project-ref')

  if (!configured) {
    const res = NextResponse.next()
    res.headers.set('Content-Security-Policy', csp)
    return res
  }

  const requestHeaders = new Headers(request.headers)

  let response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', csp)

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll() { return request.cookies.getAll() },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request: { headers: requestHeaders } })
        response.headers.set('Content-Security-Policy', csp)
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        )
      },
    },
  })

  // Verify against the Auth server rather than getSession(): getSession() silently
  // triggers its own token refresh once the access token is within 90s of expiry,
  // racing the browser's independent auto-refresh timer for the same refresh_token.
  // Supabase rotates the refresh token on each use, so whichever side loses that
  // race gets an already-invalidated token and is forced signed out — surfacing as
  // a blank dashboard roughly once an hour. getUser() only checks the existing
  // token and never refreshes, leaving the browser client as the sole refresher.
  //
  // getUser() can also throw outright (not just resolve with an error) when the
  // cookie holds a token from a stale/incompatible session — e.g. a browser that
  // still has a cookie set under an older AUTH_COOKIE_OPTIONS shape. Unhandled,
  // that exception crashes the whole middleware function and Vercel serves a bare
  // error page in place of the app — which is indistinguishable from a white
  // screen to a non-technical user. Treat a thrown error the same as "no user":
  // fall through to the normal unauthenticated redirect instead of crashing.
  let user: User | null = null
  try {
    ;({ data: { user } } = await supabase.auth.getUser())
  } catch (err) {
    console.error('middleware getUser() threw, treating as signed out:', err)
  }

  const { pathname } = request.nextUrl
  const isLoginPage = pathname === '/login'
  const isRoot = pathname === '/'
  // The STIV SSO bridge lands here unauthenticated — it establishes the
  // session client-side via setSession() using tokens minted by STIV, so it
  // must be reachable before a session cookie exists.
  const isSsoBridge = pathname === '/sso'

  // Redirect unauthenticated users to /login
  if (!user && !isLoginPage && !isRoot && !isSsoBridge) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Redirect authenticated users away from /login
  if (user && isLoginPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
