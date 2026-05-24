'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getMyUser } from '@/lib/auth'

export interface QtyColumnDef {
  key: string
  label: string
  type: 'number' | 'text'
  required?: boolean
}

export interface AddSectionPayload {
  working_sheet_item_id: string
  template_id: string | null
  title: string
  columns: QtyColumnDef[]
  formula: string | null
  unit: string
  units_count: number
  remark?: string
}

export async function addSection(payload: AddSectionPayload, wsId: string) {
  const user = await getMyUser()
  if (!user) return { error: 'unauthenticated' }
  const supabase = await createClient()

  const { count } = await supabase
    .from('cc_ws_item_qty_sections')
    .select('*', { count: 'exact', head: true })
    .eq('working_sheet_item_id', payload.working_sheet_item_id)
  const sr_no = (count ?? 0) + 1

  const { data, error } = await supabase
    .from('cc_ws_item_qty_sections')
    .insert({
      working_sheet_item_id: payload.working_sheet_item_id,
      sr_no,
      title: payload.title,
      template_id: payload.template_id,
      columns: payload.columns,
      formula: payload.formula,
      unit: payload.unit,
      units_count: payload.units_count,
      remark: payload.remark ?? null,
    })
    .select('*')
    .single()

  if (error) return { error: error.message }
  revalidatePath(`/cost-control/working-sheets/${wsId}/items/${payload.working_sheet_item_id}/qty`)
  return { ok: true, section: data }
}

export async function updateSection(
  id: string,
  patch: { title?: string; units_count?: number; remark?: string },
  wsId: string,
  itemId: string,
) {
  const user = await getMyUser()
  if (!user) return { error: 'unauthenticated' }
  const supabase = await createClient()
  const { error } = await supabase.from('cc_ws_item_qty_sections').update(patch).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath(`/cost-control/working-sheets/${wsId}/items/${itemId}/qty`)
  return { ok: true }
}

export async function deleteSection(id: string, wsId: string, itemId: string) {
  const user = await getMyUser()
  if (!user) return { error: 'unauthenticated' }
  const supabase = await createClient()
  const { error } = await supabase.from('cc_ws_item_qty_sections').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath(`/cost-control/working-sheets/${wsId}/items/${itemId}/qty`)
  return { ok: true }
}

export interface AddRowPayload {
  section_id: string
  description: string | null
  field_values: Record<string, unknown>
  computed_qty: number
  remark?: string | null
}

export async function addRow(payload: AddRowPayload, wsId: string, itemId: string) {
  const user = await getMyUser()
  if (!user) return { error: 'unauthenticated' }
  const supabase = await createClient()

  const { count } = await supabase
    .from('cc_ws_item_qty_rows')
    .select('*', { count: 'exact', head: true })
    .eq('section_id', payload.section_id)
  const sr_no = (count ?? 0) + 1

  const { data, error } = await supabase
    .from('cc_ws_item_qty_rows')
    .insert({
      section_id: payload.section_id,
      sr_no,
      description: payload.description,
      field_values: payload.field_values,
      computed_qty: payload.computed_qty,
      remark: payload.remark ?? null,
    })
    .select('*')
    .single()

  if (error) return { error: error.message }
  revalidatePath(`/cost-control/working-sheets/${wsId}/items/${itemId}/qty`)
  return { ok: true, row: data }
}

export async function updateRow(
  id: string,
  patch: {
    description?: string | null
    field_values?: Record<string, unknown>
    computed_qty?: number
    remark?: string | null
  },
  wsId: string,
  itemId: string,
) {
  const user = await getMyUser()
  if (!user) return { error: 'unauthenticated' }
  const supabase = await createClient()
  const { error } = await supabase.from('cc_ws_item_qty_rows').update(patch).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath(`/cost-control/working-sheets/${wsId}/items/${itemId}/qty`)
  return { ok: true }
}

export async function deleteRow(id: string, wsId: string, itemId: string) {
  const user = await getMyUser()
  if (!user) return { error: 'unauthenticated' }
  const supabase = await createClient()
  const { error } = await supabase.from('cc_ws_item_qty_rows').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath(`/cost-control/working-sheets/${wsId}/items/${itemId}/qty`)
  return { ok: true }
}
