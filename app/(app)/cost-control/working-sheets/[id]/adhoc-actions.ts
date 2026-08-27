'use server'
// Declare a budget adhoc or as per BOQ — the HOD's point 7.
//
// Who: the Project Head is asked at sign-off, and the Atm Head / Trustee can
// set it afterwards if he forgot. checkIsCcReviewer() is exactly that set
// (project_head / head / founder / admin), so no new role plumbing is needed.
//
// Deliberately NOT the engineer who raised the sheet: this is management
// classifying the spend, and letting the raiser self-declare "as per BOQ"
// would make the flag worth nothing.

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyProfile } from '@/lib/auth'
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'

type Result = { ok: true } | { ok: false; error: string }

/** Set (or clear) the adhoc declaration on one working sheet. */
export async function setWorkingSheetAdhoc(
  wsId: string,
  isAdhoc: boolean | null,
): Promise<Result> {
  await requirePermission('cost-control', 'edit')
  if (!(await checkIsCcReviewer())) {
    return { ok: false, error: 'Only the Project Head, Atm Head or Trustee can declare this' }
  }
  const parsed = z.object({
    ws_id: z.string().uuid(),
    is_adhoc: z.boolean().nullable(),
  }).safeParse({ ws_id: wsId, is_adhoc: isAdhoc })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()

  // The Internal Estimate baseline is not a budget request — it has no BOQ /
  // adhoc character and tagging it would pollute the counts.
  const { data: ws } = await supabase
    .from('cc_working_sheets')
    .select('id, project_id, summary_notes')
    .eq('id', wsId).maybeSingle()
  if (!ws) return { ok: false, error: 'Working sheet not found' }
  if ((ws.summary_notes as string | null)?.startsWith('[IB')) {
    return { ok: false, error: 'The Internal Estimate baseline is not an adhoc/BOQ budget' }
  }

  const profile = await getMyProfile()
  const { data, error } = await supabase
    .from('cc_working_sheets')
    .update(isAdhoc === null
      ? { is_adhoc: null, adhoc_set_by: null, adhoc_set_at: null }
      : { is_adhoc: isAdhoc, adhoc_set_by: profile?.id ?? null, adhoc_set_at: new Date().toISOString() })
    .eq('id', wsId)
    .select('id')
  if (error) return { ok: false, error: error.message }
  // An RLS refusal comes back as 200 with zero rows, never as an error.
  if (!data?.length) return { ok: false, error: 'Change was blocked — check your permissions' }

  revalidatePath(`/cost-control/working-sheets/${wsId}`)
  if (ws.project_id) revalidatePath(`/cost-control/projects/${ws.project_id}`)
  return { ok: true }
}
