import { NextResponse } from 'next/server'

// Daily ECB reference rates via frankfurter (free, no key). Proxied so the
// browser CSP stays 'self'-only, and cached for 12h at the edge.
export async function GET(req: Request) {
  const base = (new URL(req.url).searchParams.get('base') ?? 'SGD').toUpperCase()
  if (!/^[A-Z]{3}$/.test(base)) return NextResponse.json({ error: 'Invalid base' }, { status: 400 })
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=${base}`, { next: { revalidate: 43200 } })
    if (!res.ok) return NextResponse.json({ error: 'FX source unavailable' }, { status: 502 })
    const data = await res.json()
    return NextResponse.json(
      { base, date: data.date, rates: data.rates },
      { headers: { 'Cache-Control': 'public, s-maxage=43200, stale-while-revalidate=86400' } },
    )
  } catch {
    return NextResponse.json({ error: 'FX source unavailable' }, { status: 502 })
  }
}
