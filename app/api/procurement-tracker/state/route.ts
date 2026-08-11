// GET /api/procurement-tracker/state
// Returns BOTH shared org-wide procurement slots so the page can rehydrate and
// merge them:
//   • indent = 'global' slot — the Indent-to-Issue report (Needs-PO source)
//   • po     = 'po' slot     — the PO report (accurate + priced)
//
// Response: { indent: Slot | null, po: Slot | null }
//   Slot = { state, version, updatedAt, updatedByName }

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'

export const runtime = 'nodejs'

type Row = { state: unknown; version: number; updated_at: string; updated_by: string | null }

export async function GET() {
  await requirePermission('procurement-tracker', 'view')
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('procurement_tracker_state')
    .select('id, state, version, updated_at, updated_by')
    .in('id', ['global', 'po'])

  if (error) {
    console.error('[procurement] state fetch failed:', error)
    return NextResponse.json({ indent: null, po: null }, { status: 500 })
  }

  const rows = (data ?? []) as Array<Row & { id: string }>
  const byId = new Map(rows.map(r => [r.id, r]))

  // Resolve updater names in one query.
  const ids = rows.map(r => r.updated_by).filter((x): x is string => !!x)
  const nameById = new Map<string, string>()
  if (ids.length > 0) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', ids)
    for (const p of (profs ?? []) as Array<{ id: string; full_name: string | null; email: string }>) {
      nameById.set(p.id, p.full_name ?? p.email ?? '')
    }
  }

  const slot = (id: string) => {
    const r = byId.get(id)
    if (!r) return null
    return {
      state: r.state,
      version: r.version,
      updatedAt: r.updated_at,
      updatedByName: r.updated_by ? nameById.get(r.updated_by) ?? null : null,
    }
  }

  return NextResponse.json({ indent: slot('global'), po: slot('po') })
}
