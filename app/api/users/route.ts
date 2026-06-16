import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

const VALID_ROLES = ['administrator', 'inventory_manager', 'staff', 'viewer']

async function requireAdmin(req: NextRequest): Promise<string | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !anonKey || !serviceKey) return 'Supabase not configured'

  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() { return req.cookies.getAll() },
      setAll() {},
    },
  })

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 'Unauthorized'

  const res = await fetch(`${supabaseUrl}/rest/v1/users?id=eq.${user.id}&select=role`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
  })
  const data = await res.json()
  if (!data[0] || data[0].role !== 'administrator') return 'Forbidden — Administrator only'

  return null
}

export async function POST(req: NextRequest) {
  try {
    const authError = await requireAdmin(req)
    if (authError) return NextResponse.json({ error: authError }, { status: authError === 'Unauthorized' ? 401 : 403 })

    const { name, email, role, password } = await req.json()

    if (!name || !email || !role || !password) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    const authRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name, role } }),
    })

    const authData = await authRes.json()
    if (!authRes.ok) {
      return NextResponse.json({ error: authData.msg || authData.message || 'Failed to create user' }, { status: 400 })
    }

    const userId = authData.id

    const dbRes = await fetch(`${supabaseUrl}/rest/v1/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({ id: userId, name, email, role }),
    })

    if (!dbRes.ok) {
      // Roll back the auth user to avoid orphaned accounts
      await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
        method: 'DELETE',
        headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
      })
      const dbErr = await dbRes.json()
      return NextResponse.json({ error: dbErr.message || 'Profile insert failed — auth user rolled back' }, { status: 500 })
    }

    return NextResponse.json({ success: true, userId })
  } catch (err) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const authError = await requireAdmin(req)
    if (authError) return NextResponse.json({ error: authError }, { status: authError === 'Unauthorized' ? 401 : 403 })

    const { userId, password } = await req.json()
    if (!userId || !password) return NextResponse.json({ error: 'Missing userId or password' }, { status: 400 })
    if (password.length < 8) return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ password }),
    })

    if (!res.ok) {
      const err = await res.json()
      return NextResponse.json({ error: err.msg || err.message || 'Failed to reset password' }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const authError = await requireAdmin(req)
    if (authError) return NextResponse.json({ error: authError }, { status: authError === 'Unauthorized' ? 401 : 403 })

    const { userId } = await req.json()
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    // Delete auth user first (may cascade), then clean up profile
    const authRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
    })

    if (!authRes.ok) {
      return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 })
    }

    // Best-effort profile cleanup
    await fetch(`${supabaseUrl}/rest/v1/users?id=eq.${userId}`, {
      method: 'DELETE',
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
    })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
