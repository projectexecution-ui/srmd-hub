// Active users that can be @-mentioned in a comment. Feeds the mention dropdown.
// Auth-gated (must be signed in); returns id + display name only.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { personName } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ users: [] }, { status: 401 })

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, name, email')
    .eq('is_active', true)
    .limit(500)
  if (error) return NextResponse.json({ users: [], error: error.message }, { status: 500 })

  const users = (data ?? [])
    .map(p => ({ id: p.id as string, name: personName(p.full_name, p.name, p.email) }))
    .filter(u => u.name && u.name !== '—')
    .sort((a, b) => a.name.localeCompare(b.name))

  return NextResponse.json({ users })
}
