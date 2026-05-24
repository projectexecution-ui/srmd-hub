'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getMyUser } from '@/lib/auth'
import { validateFormula, type QtyColumn } from '@/lib/formula'

export interface TemplatePayload {
  id?: string
  scope: 'global' | 'discipline' | 'sub_skill'
  scope_id: string | null
  name: string
  columns: QtyColumn[]
  formula: string | null
  default_unit: string
  is_active: boolean
}

function preflight(payload: TemplatePayload): string | null {
  if (!payload.name.trim()) return 'Name is required'
  if (!payload.default_unit.trim()) return 'Default unit is required'
  if (payload.columns.length === 0 && payload.formula) {
    return 'Formula references columns but no columns are declared'
  }
  if (payload.scope !== 'global' && !payload.scope_id) {
    return 'Scope is set to discipline/sub-skill but no scope_id was selected'
  }
  // Validate column keys are unique
  const keys = new Set<string>()
  for (const c of payload.columns) {
    if (!c.key.trim()) return `Column ${c.label || '?'} has empty key`
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(c.key)) {
      return `Column key "${c.key}" must start with a letter and contain only letters, digits, or underscores`
    }
    if (keys.has(c.key)) return `Duplicate column key "${c.key}"`
    keys.add(c.key)
  }
  // Formula parses + only references declared columns
  if (payload.formula && payload.formula.trim()) {
    try {
      validateFormula(payload.formula, payload.columns)
    } catch (err) {
      return err instanceof Error ? err.message : 'Formula invalid'
    }
  }
  return null
}

export async function createTemplate(payload: TemplatePayload) {
  const user = await getMyUser()
  if (!user) return { error: 'unauthenticated' }
  const err = preflight(payload)
  if (err) return { error: err }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('cc_qty_templates')
    .insert({
      scope: payload.scope,
      scope_id: payload.scope_id,
      name: payload.name.trim(),
      columns: payload.columns,
      formula: payload.formula?.trim() || null,
      default_unit: payload.default_unit.trim(),
      is_active: payload.is_active,
      is_seed: false,
      created_by: user.id,
    })
    .select('id')
    .single()
  if (error) return { error: error.message }
  revalidatePath('/cost-control/admin/qty-templates')
  redirect(`/cost-control/admin/qty-templates/${data.id}`)
}

export async function updateTemplate(payload: TemplatePayload) {
  if (!payload.id) return { error: 'id required for update' }
  const user = await getMyUser()
  if (!user) return { error: 'unauthenticated' }
  const err = preflight(payload)
  if (err) return { error: err }

  const supabase = await createClient()
  const { error } = await supabase
    .from('cc_qty_templates')
    .update({
      scope: payload.scope,
      scope_id: payload.scope_id,
      name: payload.name.trim(),
      columns: payload.columns,
      formula: payload.formula?.trim() || null,
      default_unit: payload.default_unit.trim(),
      is_active: payload.is_active,
    })
    .eq('id', payload.id)
  if (error) return { error: error.message }
  revalidatePath('/cost-control/admin/qty-templates')
  revalidatePath(`/cost-control/admin/qty-templates/${payload.id}`)
  return { ok: true }
}

export async function deleteTemplate(id: string) {
  const user = await getMyUser()
  if (!user) return { error: 'unauthenticated' }
  const supabase = await createClient()
  const { error } = await supabase.from('cc_qty_templates').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/cost-control/admin/qty-templates')
  redirect('/cost-control/admin/qty-templates')
}
