// Per-indent chase notes for the Indent → PO Tracker.
//
//   GET  → { notes: ChaseNote[] }         all notes (team-shared)
//   POST → { note: ChaseNote }            upsert one indent's note and/or
//                                         stamp last-chased = now()
//
// Body for POST: { indentNo: string, note?: string, markChased?: boolean }
// - `note` (when provided) overwrites the free-text note.
// - `markChased: true` sets last_chased_at to now().
// Both are optional; send either or both. Any signed-in tracker viewer may
// write (chasing is a shared effort — RLS enforces authenticated-only).

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import type { ChaseNote } from '@/lib/procurement/chase-notes'

export const runtime = 'nodejs'

type Row = {
  indent_no: string
  note: string | null
  last_chased_at: string | null
  updated_at: string
  updated_by: string | null
  profiles?: { full_name: string | null } | null
}

function toNote(r: Row): ChaseNote {
  return {
    indentNo: r.indent_no,
    note: r.note ?? '',
    lastChasedAt: r.last_chased_at,
    updatedByName: r.profiles?.full_name ?? null,
    updatedAt: r.updated_at,
  }
}

export async function GET() {
  await requirePermission('procurement-tracker', 'view')
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('procurement_chase_notes')
    .select('indent_no, note, last_chased_at, updated_at, updated_by, profiles:updated_by(full_name)')

  if (error) {
    console.error('[procurement] chase-notes GET failed:', error)
    return NextResponse.json({ notes: [] })
  }
  return NextResponse.json({ notes: (data ?? []).map(r => toNote(r as unknown as Row)) })
}

export async function POST(req: Request) {
  // Writing a chase note needs at least view access; the tracker has no
  // separate edit gate for this collaborative field.
  await requirePermission('procurement-tracker', 'view')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  let body: { indentNo?: string; note?: string; markChased?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }
  const indentNo = (body.indentNo ?? '').trim()
  if (!indentNo) return NextResponse.json({ error: 'indentNo required' }, { status: 400 })

  // Build the upsert row. Only set fields the caller actually sent so a
  // "mark chased" click doesn't wipe an existing note and vice-versa.
  const row: Record<string, unknown> = { indent_no: indentNo }
  if (typeof body.note === 'string') row.note = body.note.slice(0, 2000)
  if (body.markChased) row.last_chased_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('procurement_chase_notes')
    .upsert(row, { onConflict: 'indent_no' })
    .select('indent_no, note, last_chased_at, updated_at, updated_by, profiles:updated_by(full_name)')
    .single()

  if (error) {
    console.error('[procurement] chase-notes POST failed:', error)
    return NextResponse.json({ error: 'Could not save the note.' }, { status: 500 })
  }
  return NextResponse.json({ note: toNote(data as unknown as Row) })
}
