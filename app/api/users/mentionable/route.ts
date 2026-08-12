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
    .select('id, full_name, name, email, role')
    .eq('is_active', true)
    .neq('role', 'admin')   // hide the Admin account from the tag list
    .limit(500)
  if (error) return NextResponse.json({ users: [], error: error.message }, { status: 500 })

  const users = (data ?? [])
    // hide test / demo accounts (any of the name fields flagged), so the list is
    // just real people who can actually act on a comment.
    .filter(p => {
      const blob = `${p.full_name ?? ''} ${p.name ?? ''} ${p.email ?? ''}`.toLowerCase()
      return !blob.includes('test') && !blob.includes('demo')
    })
    .map(p => ({ id: p.id as string, name: personName(p.full_name, p.name, p.email) }))
    .filter(u => u.name && u.name !== '—')
    .sort((a, b) => a.name.localeCompare(b.name))

  return NextResponse.json({ users })
}
