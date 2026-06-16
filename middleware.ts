import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  const configured = supabaseUrl.length > 0 && !supabaseUrl.includes('your-project-ref')

  // Skip auth protection when Supabase isn't connected yet
  if (!configured) return NextResponse.next()

  let response = NextResponse.next({ request })

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() { return request.cookies.getAll() },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        )
      },
    },
  })

  // Refresh session — critical for token rotation
  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isLoginPage = pathname === '/login'
  const isRoot = pathname === '/'

  // Redirect unauthenticated users to /login
  if (!user && !isLoginPage && !isRoot) {
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
