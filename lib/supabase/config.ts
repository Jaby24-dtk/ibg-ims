// Returns true only when real Supabase credentials are present
export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return url.length > 0 && !url.includes('your-project-ref')
}
