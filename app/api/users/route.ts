import { NextRequest, NextResponse } from 'next/server'
import { userFromRequest } from '@/lib/supabase/request-auth'

const VALID_ROLES = ['administrator', 'inventory_manager', 'staff', 'viewer']

type Admin = { id: string; name: string | null; email: string | null }

/** Returns the signed-in administrator, or an error message. */
async function requireAdmin(req: NextRequest): Promise<{ error: string } | { admin: Admin }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !anonKey || !serviceKey) return { error: 'Supabase not configured' }

  const user = await userFromRequest(req)
  if (!user) return { error: 'Unauthorized' }

  const res = await fetch(`${supabaseUrl}/rest/v1/users?id=eq.${user.id}&select=role,name,email`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
  })
  const data = await res.json()
  if (!data[0] || data[0].role !== 'administrator') return { error: 'Forbidden — Administrator only' }

  return { admin: { id: user.id, name: data[0].name ?? null, email: data[0].email ?? user.email ?? null } }
}

/** ISO change history for user accounts (audit_log is append-only; written with the service key). */
async function audit(admin: Admin, action: string, account: { id: string | null; label: string }, snapshot: Record<string, unknown>) {
  await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/audit_log`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY!,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      actor_id: admin.id, actor_name: admin.name, actor_email: admin.email, action,
      entity_type: 'user_account', entity_id: account.id, entity_label: account.label, snapshot,
    }),
  }).catch(() => {})
}

async function accountOf(userId: string): Promise<{ name: string | null; email: string | null; role: string | null } | null> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=name,email,role`, {
    headers: { 'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY!, 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
  })
  return res.ok ? ((await res.json())[0] ?? null) : null
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin(req)
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.error === 'Unauthorized' ? 401 : 403 })

    const { name, email, role, password } = await req.json()

    if (!name || !email || !role || !password) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 })
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

    await audit(auth.admin, 'insert', { id: userId, label: name }, { name, email, role })
    return NextResponse.json({ success: true, userId })
  } catch (err) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireAdmin(req)
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.error === 'Unauthorized' ? 401 : 403 })

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

    const account = await accountOf(userId)
    await audit(auth.admin, 'password_reset', { id: userId, label: account?.name ?? account?.email ?? userId }, { email: account?.email ?? null })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireAdmin(req)
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.error === 'Unauthorized' ? 401 : 403 })

    const { userId } = await req.json()
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    const account = await accountOf(userId)

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

    await audit(auth.admin, 'delete', { id: userId, label: account?.name ?? account?.email ?? userId }, { ...(account ?? {}) })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
