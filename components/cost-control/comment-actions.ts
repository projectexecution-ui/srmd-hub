'use server'
// Working-sheet comments — everyone who can SEE a sheet can write on it
// (engineer, Project Head, Atm Head, Trustee, Billing). Visibility is
// enforced by RLS on cc_ws_comments: the insert policy checks the caller
// can select the sheet, so nothing here needs role logic.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function addWsComment(
  wsId: string,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { ok: false, error: 'Not signed in' }

  const text = body.trim()
  if (text.length < 1) return { ok: false, error: 'Write something first' }
  if (text.length > 2000) return { ok: false, error: 'Keep comments under 2,000 characters' }

  const { error } = await supabase
    .from('cc_ws_comments')
    .insert({ ws_id: wsId, author_id: auth.user.id, body: text })
  if (error) {
    // RLS rejection reads cryptically — translate for laymen.
    if (/row-level security/i.test(error.message)) {
      return { ok: false, error: 'You do not have access to comment on this sheet' }
    }
    return { ok: false, error: error.message }
  }

  revalidatePath(`/cost-control/working-sheets/${wsId}`)
  return { ok: true }
}
