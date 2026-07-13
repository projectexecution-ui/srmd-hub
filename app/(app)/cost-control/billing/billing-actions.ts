'use server'
// Billing queue actions — marking a Trustee-released sheet as "entered in
// IN4". Pure tracking: no money is written anywhere (Budget (ERP) comes
// only from the BPH pull), the DB-side cc_mark_in4_entered RPC enforces
// role + status + no-double-marking.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

/** The caller's effective cost-control role (override-or-default). */
export async function getEffectiveCcRole(): Promise<string | null> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return null
  const { data } = await supabase.rpc('effective_user_role', {
    p_user_id: auth.user.id,
    p_module_slug: 'cost-control',
  })
  return (data as string | null) ?? null
}

export async function markEnteredInIn4(
  wsId: string,
  ref: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('cc_mark_in4_entered', {
    p_ws_id: wsId,
    p_ref: ref?.trim() || null,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/cost-control/billing')
  revalidatePath(`/cost-control/working-sheets/${wsId}`)
  revalidatePath('/cost-control')
  return { ok: true }
}
