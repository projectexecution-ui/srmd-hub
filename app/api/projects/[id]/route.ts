// Project delete endpoint with a dependency safety check.
//
// GET  /api/projects/{id} → returns counts of dependent rows.
// DELETE /api/projects/{id} → re-checks deps server-side, then hard-deletes
//   only if every counted table is empty. Otherwise returns 409 with the
//   blocking counts.
//
// We DO NOT cascade-delete dependent data. Old indents / POs / invoices /
// JMR entries / cost-control rows / etc. carry historical FK links and
// blowing them away would destroy reporting in other modules. If you want
// to retire a project that has history, "Archive" it (status='archived')
// from the project form instead.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMyPermissions, can } from '@/lib/auth'

// Tables that reference public.projects via project_id (or parent_project_id).
// Keep this list in sync with the schema. invoices has no direct project_id —
// it's linked via purchase_orders.po_id, handled below as a special case.
const DEP_TABLES: Array<{
  table: string
  column: string
  label: string
  module: string
}> = [
  { table: 'projects',                 column: 'parent_project_id', label: 'Sub-projects',          module: 'Projects'        },
  { table: 'indents',                  column: 'project_id',        label: 'Indents',               module: 'Indent → PO'     },
  { table: 'purchase_orders',          column: 'project_id',        label: 'Purchase Orders',       module: 'Indent → PO'     },
  { table: 'jmr_daily_entries',        column: 'project_id',        label: 'JMR daily entries',     module: 'JMR'             },
  { table: 'jmr_bills',                column: 'project_id',        label: 'JMR bills',             module: 'JMR'             },
  { table: 'jmr_rate_cards',           column: 'project_id',        label: 'JMR rate cards',        module: 'JMR'             },
  { table: 'jmr_user_project_access',  column: 'project_id',        label: 'JMR user assignments',  module: 'JMR'             },
  { table: 'cc_working_sheets',        column: 'project_id',        label: 'Cost Control sheets',   module: 'Cost Control'    },
  { table: 'cc_budget_lines',          column: 'project_id',        label: 'Cost Control budgets',  module: 'Cost Control'    },
  { table: 'cc_project_disciplines',   column: 'project_id',        label: 'CC project disciplines',module: 'Cost Control'    },
  { table: 'cc_project_sub_skills',    column: 'project_id',        label: 'CC project sub-skills', module: 'Cost Control'    },
]

async function countDeps(projectId: string) {
  const supabase = await createClient()
  const direct = await Promise.all(
    DEP_TABLES.map(async d => {
      const { count } = await supabase
        .from(d.table)
        .select('*', { count: 'exact', head: true })
        .eq(d.column, projectId)
      return { ...d, count: count ?? 0 }
    })
  )

  // Invoices have no project_id of their own — they hang off purchase_orders.
  // Count via an inner join.
  const { count: invoiceCount } = await supabase
    .from('invoices')
    .select('id, purchase_orders!inner(project_id)', { count: 'exact', head: true })
    .eq('purchase_orders.project_id', projectId)

  return [
    ...direct,
    {
      table: 'invoices',
      column: 'po_id',
      label: 'Invoices',
      module: 'Invoices',
      count: invoiceCount ?? 0,
    },
  ]
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const perms = await getMyPermissions()
  if (!can(perms, 'projects', 'view')) return new NextResponse('Forbidden', { status: 403 })
  const { id } = await ctx.params
  const deps = await countDeps(id)
  const blocking = deps.filter(d => d.count > 0)
  return NextResponse.json({
    deps,
    canDelete: blocking.length === 0,
    blocking,
  })
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const perms = await getMyPermissions()
  if (!can(perms, 'projects', 'edit')) return new NextResponse('Forbidden', { status: 403 })
  const { id } = await ctx.params
  const deps = await countDeps(id)
  const blocking = deps.filter(d => d.count > 0)
  if (blocking.length > 0) {
    return NextResponse.json(
      {
        error: 'Project has dependent data',
        blocking,
        hint: 'Archive the project instead (set status=archived in the edit form), or remove the dependent rows first.',
      },
      { status: 409 }
    )
  }
  const supabase = await createClient()
  const { error } = await supabase.from('projects').delete().eq('id', id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
