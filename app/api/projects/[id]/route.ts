// Project delete endpoint with a "real work" safety check.
//
// GET  /api/projects/{id} → returns counts of the blocking tables.
// DELETE /api/projects/{id} → admin only; refuses if the project has any REAL
//   work in another module, otherwise hard-deletes it.
//
// We deliberately DON'T block on setup scaffolding. A project accumulates
// ticked disciplines / sub-skills, approver rows, BPH-synced budget lines,
// discipline assignments, floors, etc. — none of which is human work product,
// and all of which Postgres CASCADE-deletes with the project (see the FK graph:
// cc_project_disciplines / cc_project_sub_skills / cc_project_approvers /
// cc_budget_lines / cc_budget_events … are all ON DELETE CASCADE). So a project
// created by mistake can be removed cleanly even after setup was started.
//
// What we DO protect is real, human-created history in other modules — indents,
// POs, invoices, contractor/JMR bills, JMR daily entries, Daily Site Reports,
// inventory requests, engineer working sheets, and sub-projects. If any exist we
// refuse and name them (the admin must handle those deliberately, not nuke them).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMyPermissions, can, getMyProfile, isPortalOwner } from '@/lib/auth'

// Tables whose presence = real work worth protecting. Everything else that
// references projects cascades or set-nulls automatically and never blocks.
// invoices has no direct project_id — linked via purchase_orders, special-cased.
const BLOCK_TABLES: Array<{
  table: string
  column: string
  label: string
  module: string
}> = [
  { table: 'projects',            column: 'parent_project_id', label: 'Sub-projects',        module: 'Projects'          },
  { table: 'indents',             column: 'project_id',        label: 'Indents',             module: 'Indent → PO'       },
  { table: 'purchase_orders',     column: 'project_id',        label: 'Purchase Orders',     module: 'Indent → PO'       },
  { table: 'cc_working_sheets',   column: 'project_id',        label: 'Cost Control sheets', module: 'Cost Control'      },
  { table: 'cc_bills',            column: 'project_id',        label: 'Contractor bills',    module: 'Bills'             },
  { table: 'jmr_daily_entries',   column: 'project_id',        label: 'JMR daily entries',   module: 'JMR'               },
  { table: 'jmr_bills',           column: 'project_id',        label: 'JMR bills',           module: 'JMR'               },
  { table: 'dsr_reports',         column: 'project_id',        label: 'Daily Site Reports',  module: 'Daily Site Report' },
  { table: 'inv_requests',        column: 'project_id',        label: 'Inventory requests',  module: 'Inventory'         },
]

async function countBlocking(projectId: string) {
  const supabase = await createClient()
  const direct = await Promise.all(
    BLOCK_TABLES.map(async d => {
      const { count } = await supabase
        .from(d.table)
        .select('*', { count: 'exact', head: true })
        .eq(d.column, projectId)
      return { ...d, count: count ?? 0 }
    })
  )

  // Invoices have no project_id of their own — they hang off purchase_orders.
  const { count: invoiceCount } = await supabase
    .from('invoices')
    .select('id, purchase_orders!inner(project_id)', { count: 'exact', head: true })
    .eq('purchase_orders.project_id', projectId)

  return [
    ...direct,
    { table: 'invoices', column: 'po_id', label: 'Invoices', module: 'Invoices', count: invoiceCount ?? 0 },
  ]
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const perms = await getMyPermissions()
  if (!can(perms, 'projects', 'view')) return new NextResponse('Forbidden', { status: 403 })
  const { id } = await ctx.params
  const deps = await countBlocking(id)
  const blocking = deps.filter(d => d.count > 0)
  return NextResponse.json({ deps, canDelete: blocking.length === 0, blocking })
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Permanent delete is admin / portal-owner only — Coordinators & uploaders can
  // Archive a project (soft, reversible), but only an admin removes it for good.
  const [profile, po] = await Promise.all([getMyProfile(), isPortalOwner()])
  if (!(po || profile?.role === 'admin')) return new NextResponse('Forbidden — admin only', { status: 403 })
  const { id } = await ctx.params

  const deps = await countBlocking(id)
  const blocking = deps.filter(d => d.count > 0)
  if (blocking.length > 0) {
    return NextResponse.json(
      {
        error: 'Project has real work in other modules',
        blocking,
        hint: 'Handle those records first (or keep the project Archived). Setup like disciplines & sub-skills is cleared automatically.',
      },
      { status: 409 }
    )
  }

  // Clean project (setup scaffolding only): delete it. Postgres CASCADE removes
  // the disciplines / sub-skills / approvers / budget lines with it.
  const supabase = await createClient()
  const { error } = await supabase.from('projects').delete().eq('id', id)
  if (error) {
    // A leftover FK from some module we don't pre-check (e.g. a JMR rate-change
    // log): surface it as a clean "still linked" refusal, not a 500.
    if (error.code === '23503') {
      return NextResponse.json(
        {
          error: 'Project still has linked records in another module',
          hint: 'Keep it Archived, or clear those records first.',
          detail: error.message,
        },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
