// "Not ordering" list for the Indent → PO Tracker.
//
//   GET    → { dropped: DroppedLine[] }     every dropped item (team-shared)
//   POST   → { dropped: DroppedLine }        drop one item (body below)
//   DELETE → { ok: true }                    restore one item (body: { lineKey })
//
// POST body: { lineKey, indentNo?, material?, block?, reason? }
// Any signed-in tracker viewer may drop/restore (collaborative; RLS enforces auth).

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import type { DroppedLine } from '@/lib/procurement/dropped'

export const runtime = 'nodejs'

type Row = {
  line_key: string
  indent_no: string | null
  material: string | null
  block: string | null
  reason: string | null
  dropped_at: string
  profiles?: { full_name: string | null } | null
}

function toDropped(r: Row): DroppedLine {
  return {
    lineKey: r.line_key,
    indentNo: r.indent_no ?? '',
    material: r.material ?? '',
    block: r.block ?? '',
    reason: r.reason,
    droppedAt: r.dropped_at,
    droppedByName: r.profiles?.full_name ?? null,
  }
}

export async function GET() {
  await requirePermission('procurement-tracker', 'view')
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('procurement_dropped_lines')
    .select('line_key, indent_no, material, block, reason, dropped_at, profiles:dropped_by(full_name)')
  if (error) {
    console.error('[procurement] dropped GET failed:', error)
    return NextResponse.json({ dropped: [] })
  }
  return NextResponse.json({ dropped: (data ?? []).map(r => toDropped(r as unknown as Row)) })
}

export async function POST(req: Request) {
  await requirePermission('procurement-tracker', 'view')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  let body: { lineKey?: string; indentNo?: string; material?: string; block?: string; reason?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const lineKey = (body.lineKey ?? '').trim()
  if (!lineKey) return NextResponse.json({ error: 'lineKey required' }, { status: 400 })

  const { data, error } = await supabase
    .from('procurement_dropped_lines')
    .upsert({
      line_key: lineKey,
      indent_no: body.indentNo ?? null,
      material: body.material ?? null,
      block: body.block ?? null,
      reason: (body.reason ?? '').slice(0, 500) || null,
    }, { onConflict: 'line_key' })
    .select('line_key, indent_no, material, block, reason, dropped_at, profiles:dropped_by(full_name)')
    .single()

  if (error) {
    console.error('[procurement] dropped POST failed:', error)
    return NextResponse.json({ error: 'Could not drop this item.' }, { status: 500 })
  }
  return NextResponse.json({ dropped: toDropped(data as unknown as Row) })
}

export async function DELETE(req: Request) {
  await requirePermission('procurement-tracker', 'view')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  let body: { lineKey?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const lineKey = (body.lineKey ?? '').trim()
  if (!lineKey) return NextResponse.json({ error: 'lineKey required' }, { status: 400 })

  const { error } = await supabase.from('procurement_dropped_lines').delete().eq('line_key', lineKey)
  if (error) {
    console.error('[procurement] dropped DELETE failed:', error)
    return NextResponse.json({ error: 'Could not restore this item.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
