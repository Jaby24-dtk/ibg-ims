import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { AUTH_COOKIE_OPTIONS } from '@/lib/supabase/config'

// Emails queued in-app notifications (form assigned / submitted / approved / remark …) via
// Brevo's transactional API. Called fire-and-forget by the browser after each form action.
// Needs BREVO_API_KEY + MAIL_FROM (a Brevo-verified sender); without them notifications
// stay in-app only and are left queued.

const APP_URL = process.env.APP_URL ?? 'https://ims.ibgctasia.com'

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

function accessTokenFromCookies(req: NextRequest): string | null {
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

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })
  // Verify the caller's access token only — never a server-side refresh. This
  // route can't write cookies back, so a refresh here would rotate (burn) the
  // browser's refresh token and sign the user out moments later. It also used
  // to read the default sb-<ref>-auth-token name instead of the app's renamed
  // cookie, so it never found the real session and 401'd on every call.
  const accessToken = accessTokenFromCookies(req)
  if (!accessToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createSupabaseClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: { user } } = await sb.auth.getUser(accessToken)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const apiKey = process.env.BREVO_API_KEY
  const from = process.env.MAIL_FROM
  if (!apiKey || !from) return NextResponse.json({ sent: 0, skipped: 'email not configured' })

  const admin = createAdminClient()
  const since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
  const { data: pending, error } = await admin.from('notifications')
    .select('id').is('emailed_at', null).gte('created_at', since).limit(50)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!pending?.length) { console.log('[notify] nothing queued'); return NextResponse.json({ sent: 0 }) }

  // Claim rows first so two simultaneous calls never email the same notification twice.
  const { data: claimed } = await admin.from('notifications')
    .update({ emailed_at: new Date().toISOString() })
    .in('id', pending.map(p => p.id)).is('emailed_at', null)
    .select('id, title, body, link, users!notifications_user_id_fkey(email, name)')
  let sent = 0
  for (const n of claimed ?? []) {
    const u = (Array.isArray(n.users) ? n.users[0] : n.users) as { email: string; name: string } | null
    if (!u?.email) { console.warn('[notify] no email for notification', n.id); continue }
    const link = n.link ? `${APP_URL}${n.link}` : APP_URL
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: from, name: 'I-BG IMS' },
        to: [{ email: u.email, name: u.name }],
        subject: n.title,
        htmlContent: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0F172A">
          <p>Hi ${esc(u.name ?? '')},</p>
          <p>${esc(n.body ?? n.title)}</p>
          <p><a href="${esc(link)}" style="display:inline-block;background:#2FA6B8;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Open in I-BG IMS</a></p>
          <p style="color:#94A3B8;font-size:12px">You're receiving this because you're on this form or stock count in the I-BG inventory system.</p>
        </div>`,
      }),
    })
    if (res.ok) sent++
    else {
      console.error('[notify] Brevo rejected', res.status, (await res.text()).slice(0, 300))
      await admin.from('notifications').update({ emailed_at: null }).eq('id', n.id)
    }
  }
  console.log('[notify] sent', sent, 'of', claimed?.length ?? 0)
  return NextResponse.json({ sent })
}
