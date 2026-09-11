'use server'
// Accounts tab actions: mark a Trust discrepancy as explained (with a note).

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAccounts } from '@/lib/accounts/access'
import { parsePaymentId } from '@/lib/accounts/payments'

export type Result = { ok: boolean; message?: string }

export async function markExplained(projectId: string, paymentId: string, note: string): Promise<Result> {
  const gate = await requireAccounts(projectId)
  if (!gate.ok) return { ok: false, message: gate.reason }
  const parsed = parsePaymentId(paymentId)
  if (!parsed) return { ok: false, message: 'Unknown payment.' }
  const supabase = await createClient()
  const { data: existing } = await supabase.from('accounts_payment_confirmations').select('id, remark').eq('source', parsed.source).eq('certificate_id', parsed.certificateId).maybeSingle()
  const remark = [existing?.remark, note.trim() ? `Explained: ${note.trim()}` : 'Explained'].filter(Boolean).join(' · ')
  const { error } = await supabase.from('accounts_payment_confirmations').upsert(
    { project_id: projectId, source: parsed.source, certificate_id: parsed.certificateId, status: 'explained', remark, updated_at: new Date().toISOString(), updated_by: gate.userId },
    { onConflict: 'source,certificate_id' })
  if (error) return { ok: false, message: error.message }
  revalidatePath(`/project/${projectId}/accounts`)
  return { ok: true }
}

/** Undo: back to what the Trust said (or nothing, if we only had our own note). */
export async function reopen(projectId: string, paymentId: string): Promise<Result> {
  const gate = await requireAccounts(projectId)
  if (!gate.ok) return { ok: false, message: gate.reason }
  const parsed = parsePaymentId(paymentId)
  if (!parsed) return { ok: false, message: 'Unknown payment.' }
  const supabase = await createClient()
  const { error } = await supabase.from('accounts_payment_confirmations').delete().eq('source', parsed.source).eq('certificate_id', parsed.certificateId)
  if (error) return { ok: false, message: error.message }
  revalidatePath(`/project/${projectId}/accounts`)
  return { ok: true }
}
