import { NextRequest, NextResponse } from 'next/server'
import { parseProcurementReport } from '@/lib/procurement-tracker'
import type {
  ProjectSummary, LineRecord, IndentStatusSnapshot, LineStatusSnapshot,
} from '@/lib/procurement'
import { computeDiff } from '@/lib/procurement/storage'
import { requirePermission } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getSettings } from '@/lib/warehouse/data'
import { isOn } from '@/lib/warehouse/settings'
import { runIn4Sync } from '@/lib/warehouse/in4-sync-apply'

export const runtime = 'nodejs'
// 60s ceiling — bigger Excels can take longer once the state JSONB
// gets large enough that the Supabase upsert dominates wall time.
// Vercel Pro caps at 300, but 60 has been comfortable in practice.
export const maxDuration = 60

// Shape of the JSONB blob persisted in `procurement_tracker_state`.
interface StoredStateShape {
  format: 'banded' | 'flat'
  fileName: string
  savedAt: string
  projects: ProjectSummary[]
  pendingLineCount: number
  totalGrnValue: number
  pendingValue: number
  indentStatuses: IndentStatusSnapshot[]
  lineStatuses: LineStatusSnapshot[]
}

export async function POST(req: NextRequest) {
  await requirePermission('procurement-tracker', 'view')

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }
    const validTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ]
    if (!validTypes.includes(file.type) && !file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      return NextResponse.json({ error: 'Please upload an Excel file (.xlsx or .xls)' }, { status: 400 })
    }
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large. Max 20MB.' }, { status: 400 })
    }

    const buffer = await file.arrayBuffer()
    const result = parseProcurementReport(buffer)

    // Route each report to its own slot so the two IN4 exports coexist and get
    // merged at read time (see lib/procurement/merge):
    //   • banded  = PURCHINDENT_TO_ISSUE_RPT → 'global' (the Needs-PO source)
    //   • flat    = PUR_PurchaseOrderReport  → 'po'     (accurate + priced)
    // Uploading the PO report therefore NEVER overwrites the indent report.
    const slotId = result.format === 'flat' ? 'po' : 'global'

    // Build the persisted state shape from the parse result.
    const allLines: LineRecord[] = result.projects.flatMap(p => p.lines)
    const allIndents = result.projects.flatMap(p => p.indents)
    const savedAt = new Date().toISOString()
    const pendingLineCount = result.projects.reduce((s, p) => s + p.pendingLineCount, 0)
    const pendingValue = result.projects.reduce((s, p) => s + p.pendingValue, 0)
    const totalGrnValue = result.projects.reduce((s, p) => s + p.totalGrnValue, 0)
    const lineStatuses: LineStatusSnapshot[] = allLines.map(l => ({
      id: l.id, status: l.status, pendingQty: l.pendingQty,
    }))
    const indentStatuses: IndentStatusSnapshot[] = allIndents.map(i => ({
      indentNo: i.indentNo, status: i.status, pendingValue: i.pendingValue,
    }))

    // sourceRows balloons the JSONB by 3-5×. They're only needed for
    // the in-session inspector (verifying a row against the raw Excel
    // cells). Strip them before persisting so the upsert finishes
    // inside Vercel's function-timeout window — the parsed result
    // returned to the CALLER below still includes them.
    const projectsForState = result.projects.map(p => ({
      ...p,
      lines: p.lines.map(l => {
        const copy: LineRecord & { sourceRows?: unknown } = { ...l }
        delete copy.sourceRows
        return copy
      }),
    }))

    const nextState: StoredStateShape = {
      format: result.format,
      fileName: file.name,
      savedAt,
      projects: projectsForState,
      pendingLineCount,
      totalGrnValue,
      pendingValue,
      indentStatuses,
      lineStatuses,
    }

    // ─── Persist + compute diff against the previous state ────────
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    // Read the existing state (if any) so we can:
    //   1. snapshot it to history BEFORE we overwrite
    //   2. compute the NEW / UPDATED diff vs its lineStatuses
    const { data: prevRow } = await supabase
      .from('procurement_tracker_state')
      .select('state, version, updated_at, updated_by')
      .eq('id', slotId)
      .maybeSingle()
    const prevState = (prevRow?.state ?? null) as StoredStateShape | null
    const prevVersion = prevRow?.version ?? 0
    let prevUpdatedByName: string | null = null
    if (prevState && prevRow?.updated_by) {
      const { data: prevProfile } = await supabase
        .from('profiles')
        .select('full_name, email')
        .eq('id', prevRow.updated_by)
        .maybeSingle()
      prevUpdatedByName = prevProfile?.full_name ?? prevProfile?.email ?? null
    }

    // Snapshot the OLD state to history (best-effort — don't fail
    // the upload if the history write hiccups).
    if (prevState) {
      try {
        await supabase.from('procurement_tracker_state_history').insert({
          state_id: slotId,
          state: prevState,
          version: prevVersion,
          snapshot_by: user?.id ?? null,
        })
      } catch (e) {
        console.warn('[procurement] history snapshot failed (non-fatal):', e)
      }
    }

    // Upsert the new state. Bumping version each write so future
    // optimistic-concurrency clients can detect drift.
    const { error: writeError } = await supabase
      .from('procurement_tracker_state')
      .upsert({
        id: slotId,
        state: nextState,
        version: prevVersion + 1,
        updated_at: savedAt,
        updated_by: user?.id ?? null,
      })
    if (writeError) {
      // Likely RLS: caller doesn't have writer perm. Still return
      // the parsed result so they at least see the dashboard for
      // their own session — they just won't be the one persisting.
      console.error('[procurement] state upsert failed:', writeError)
    }

    // Compute the diff server-side. Convert the Set fields to arrays
    // so they survive JSON serialization; the client converts back.
    const diff = prevState
      ? computeDiff(
          allIndents,
          allLines,
          prevState.indentStatuses ?? [],
          prevState.lineStatuses ?? [],
          { savedAt: prevState.savedAt, fileName: prevState.fileName },
        )
      : null

    // Register every project name into the known-projects registry
    // (drives the /procurement-tracker/admin visibility picker).
    try {
      const rows = result.projects
        .map(p => p.projectName?.trim())
        .filter((n): n is string => !!n)
        .map(name => ({ name, last_seen_at: savedAt, last_seen_by: user?.id ?? null }))
      if (rows.length > 0) {
        await supabase.from('procurement_known_projects').upsert(rows, { onConflict: 'name' })
      }
    } catch (e) {
      console.warn('[procurement] known-projects upsert failed:', e)
    }

    // Feed the warehouse from the same upload. Anything IN4 has named that the
    // gate does not know about yet — new material, new units and trades, newly
    // issued purchase orders with their rates — comes across here, so nobody has
    // to remember a second step.
    //
    // Wrapped so it can never break an upload: the tracker's own job is already
    // done and saved by this point, and a warehouse problem must not look like a
    // failed upload. It is additive and re-runnable, so the next upload simply
    // picks up whatever this one missed.
    let warehouse: { added?: string; error?: string } | null = null
    try {
      const values = await getSettings()
      if (isOn(values, 'wh_auto_sync_on_upload')) {
        const res = await runIn4Sync(['items', 'units', 'disciplines', 'pos'], user?.id ?? null)
        if (res.ok) {
          const bits = [
            res.itemsCreated ? `${res.itemsCreated} items` : '',
            res.itemsAdopted ? `${res.itemsAdopted} items linked` : '',
            res.unitsCreated ? `${res.unitsCreated} units` : '',
            res.disciplinesCreated ? `${res.disciplinesCreated} trades` : '',
            res.posCreated ? `${res.posCreated} POs (${res.poLinesCreated} lines)` : '',
          ].filter(Boolean)
          warehouse = { added: bits.length ? bits.join(', ') : 'nothing new' }
          console.log('[procurement] warehouse sync:', warehouse.added)
        } else {
          warehouse = { error: res.error }
          console.error('[procurement] warehouse sync failed:', res.error)
        }
      }
    } catch (e) {
      warehouse = { error: e instanceof Error ? e.message : 'Warehouse sync failed' }
      console.error('[procurement] warehouse sync threw:', e)
    }

    return NextResponse.json({
      success: true,
      fileName: file.name,
      format: result.format,
      warehouse,
      projects: result.projects,
      diff: diff ? {
        prevSavedAt: diff.prevSavedAt,
        prevFileName: diff.prevFileName,
        prevUpdatedByName,
        changedIndents: Array.from(diff.changedIndents),
        newLineIds: Array.from(diff.newLineIds),
        changedLineIds: Array.from(diff.changedLineIds),
        newlyGrnDone: diff.newlyGrnDone,
        newlyInProgress: diff.newlyInProgress,
        newlyOverdue: diff.newlyOverdue,
        newlyComplete: diff.newlyComplete,
      } : null,
    })
  } catch (err) {
    console.error('Procurement parse error:', err)
    const message = err instanceof Error ? err.message : 'Failed to parse file.'
    return NextResponse.json(
      { error: message },
      { status: 500 },
    )
  }
}
