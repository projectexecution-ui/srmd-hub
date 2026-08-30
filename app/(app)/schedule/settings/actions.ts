'use server'
// Schedule settings writes. The four sched_* keys have always been READ
// (lib/schedule/data.ts) but nothing ever wrote them — lib/schedule/types.ts
// even says "editable in Settings" while no Settings screen existed. This is it.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getMyPermissions, can } from '@/lib/auth'

export interface SaveScheduleSettingsInput {
  procurementDays: number
  approvalDays: number
  drawingDays: number
  aiAssistProjectIds: string[]
}

export type SaveResult = { ok: true } | { ok: false; error: string }

/** Lead times are a portfolio-wide build decision — same gate as adding or
 *  removing work items (see gate('admin') in ../actions.ts). */
async function requireAdmin(): Promise<string | null> {
  const perms = await getMyPermissions()
  if (!can(perms, 'schedule', 'admin')) {
    return 'Only a schedule admin can change these — ask a project head.'
  }
  return null
}

/** Days must be whole and non-negative; a silently coerced value would make
 *  every work-back date wrong without anyone noticing. */
function cleanDays(n: number, field: string): { ok: true; value: number } | { ok: false; error: string } {
  if (!Number.isFinite(n)) return { ok: false, error: `${field} must be a number.` }
  const v = Math.round(n)
  if (v < 0) return { ok: false, error: `${field} cannot be negative.` }
  if (v > 365) return { ok: false, error: `${field} looks wrong — keep it under 365 days.` }
  return { ok: true, value: v }
}

export async function saveScheduleSettings(input: SaveScheduleSettingsInput): Promise<SaveResult> {
  const denied = await requireAdmin()
  if (denied) return { ok: false, error: denied }

  const procurement = cleanDays(input.procurementDays, 'Procurement lead time')
  if (!procurement.ok) return procurement
  const approval = cleanDays(input.approvalDays, 'Approval lead time')
  if (!approval.ok) return approval
  const drawing = cleanDays(input.drawingDays, 'Drawing lead time')
  if (!drawing.ok) return drawing

  const ids = Array.from(new Set(
    (input.aiAssistProjectIds ?? []).filter(id => /^[0-9a-f-]{36}$/i.test(id)),
  ))

  const supabase = await createClient()
  const { error } = await supabase.from('app_settings').upsert([
    { key: 'sched_lead_procurement_days', value: String(procurement.value) },
    { key: 'sched_lead_approval_days', value: String(approval.value) },
    { key: 'sched_lead_drawing_days', value: String(drawing.value) },
    { key: 'sched_ai_assist_projects', value: JSON.stringify(ids) },
  ], { onConflict: 'key' })

  if (error) return { ok: false, error: error.message }

  revalidatePath('/schedule')
  revalidatePath('/schedule/settings')
  return { ok: true }
}
