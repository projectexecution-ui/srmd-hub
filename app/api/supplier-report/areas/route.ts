// Returns built-up areas (sq ft) per project name, sourced from the Budget
// vs Actual hub state (budget_hub_state → projects[].areaStatement.builtUp).
// The Supplier Report uses this to auto-fill Rs/Sft area by matching each
// sub-project name; the user can still override manually.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const { data, error } = await supabase
    .from('budget_hub_state')
    .select('state')
    .eq('id', 'global')
    .single()
  if (error) return NextResponse.json({ areas: {} })

  const areas: Record<string, number> = {}
  const projects = (data?.state as { projects?: Array<{ name?: string; areaStatement?: { builtUp?: number } }> })?.projects ?? []
  for (const p of projects) {
    const name = (p?.name ?? '').trim()
    const built = p?.areaStatement?.builtUp
    if (name && typeof built === 'number' && built > 0) areas[name] = built
  }
  return NextResponse.json({ areas })
}
