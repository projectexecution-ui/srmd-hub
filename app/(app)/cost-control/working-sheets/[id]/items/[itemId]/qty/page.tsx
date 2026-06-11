import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/ui/query-error'
import { wsStatusLabel } from '@/components/cost-control/WSStatusPill'
import { ChevronLeft } from 'lucide-react'
import { QtyEditor } from './QtyEditor'

export const dynamic = 'force-dynamic'

export default async function QuantificationPage({
  params,
}: {
  params: Promise<{ id: string; itemId: string }>
}) {
  const perms = await requirePermission('cost-control', 'view')
  const canEdit = can(perms, 'cost-control', 'edit')
  const { id: wsId, itemId } = await params
  const supabase = await createClient()

  const { data: item, error: itemErr } = await supabase
    .from('cc_working_sheet_items')
    .select(
      `*, cc_working_sheets(id, ws_code, status, project_id, discipline_id, sub_skill_id, cc_sub_skills(name))`,
    )
    .eq('id', itemId)
    .single()

  // PGRST116 = .single() found no row → a genuine 404. Anything else is a
  // transient query failure and must NOT render the not-found page.
  if (itemErr && itemErr.code !== 'PGRST116') {
    return (
      <div className="p-4 md:p-6 max-w-6xl mx-auto">
        <QueryError message={itemErr.message} what="this item" />
      </div>
    )
  }
  if (!item) notFound()
  const wsRaw = (item as unknown as {
    cc_working_sheets:
      | {
          id: string
          status: string
          ws_code: string
          discipline_id: string
          sub_skill_id: string
          cc_sub_skills: { name: string } | null
        }
      | Array<{ id: string; status: string; ws_code: string; discipline_id: string; sub_skill_id: string; cc_sub_skills: { name: string } | null }>
  }).cc_working_sheets
  const ws = Array.isArray(wsRaw) ? wsRaw[0] : wsRaw

  const { data: sections } = await supabase
    .from('cc_ws_item_qty_sections')
    .select(`*, rows:cc_ws_item_qty_rows(*)`)
    .eq('working_sheet_item_id', itemId)
    .order('sr_no')

  const { data: templates } = await supabase
    .from('cc_qty_templates')
    .select('*')
    .eq('is_active', true)
    .or(
      `scope.eq.global,and(scope.eq.discipline,scope_id.eq.${ws.discipline_id}),and(scope.eq.sub_skill,scope_id.eq.${ws.sub_skill_id})`,
    )
    .order('is_seed', { ascending: false })
    .order('name')

  const isDraft = ws.status === 'draft' || ws.status === 'returned'
  const readOnly = !isDraft || !canEdit

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <Link
        href={`/cost-control/working-sheets/${wsId}`}
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
      >
        <ChevronLeft className="h-4 w-4" /> Back to {ws.ws_code}
      </Link>

      <PageHeader
        title="Quantification working"
        subtitle={`${ws.ws_code} · Item ${item.sr_no}: ${item.description} · current qty: ${Number(item.qty).toLocaleString('en-IN')} ${item.uom}${item.qty_is_auto ? ' (auto-derived)' : ''}`}
      />

      {readOnly && !isDraft && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          This sheet is {wsStatusLabel(ws.status)} — quantification is read-only.
        </div>
      )}

      <QtyEditor
        wsId={wsId}
        itemId={itemId}
        itemUom={item.uom}
        readOnly={readOnly}
        sections={(sections ?? []) as unknown as ServerSection[]}
        templates={(templates ?? []) as unknown as ServerTemplate[]}
      />
    </div>
  )
}

export interface ServerSection {
  id: string
  sr_no: number
  title: string
  template_id: string | null
  columns: { key: string; label: string; type: 'number' | 'text'; required?: boolean }[]
  formula: string | null
  unit: string
  units_count: number
  section_total: number
  remark: string | null
  rows: ServerRow[]
}

export interface ServerRow {
  id: string
  section_id: string
  sr_no: number
  description: string | null
  field_values: Record<string, unknown>
  computed_qty: number
  remark: string | null
}

export interface ServerTemplate {
  id: string
  scope: 'global' | 'discipline' | 'sub_skill'
  scope_id: string | null
  name: string
  columns: { key: string; label: string; type: 'number' | 'text'; required?: boolean }[]
  formula: string | null
  default_unit: string
  is_seed: boolean
}
