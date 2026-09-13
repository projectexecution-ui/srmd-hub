'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireBillsWrite } from '@/lib/bills-booking/access'

/**
 * Record the Atm Head's sanction on one IN4 certificate.
 *
 * This is the record of who approved what. Since the decision on 13 Sep 2026,
 * IN4's own trail will name whoever in CT Billing keyed the approval, so if
 * this row is wrong there is nothing else to fall back on.
 *
 * Two things are therefore done here rather than trusted to the caller:
 *
 *   · The amount is read from the IN4 mirror on the server, not taken from the
 *     form. A number posted by a browser is not evidence of what was on the
 *     screen, and the whole value of the reconciliation is that the figure was
 *     fixed at the moment of the click.
 *   · The contractor, work order and document number are copied in alongside
 *     it. Joining them later would mean the record of what was approved could
 *     change under a re-sync.
 *
 * The table has no update or delete policy for users, so a wrong sanction is
 * corrected by making a new one; the old row is marked superseded and stays.
 */
export async function sanctionCertificate(input: {
  certificateId: number
  note?: string | null
}): Promise<{ ok: boolean; error?: string; amount?: number }> {
  await requireBillsWrite()
  const supabase = await createClient()

  const { data: me } = await supabase.auth.getUser()
  const uid = me?.user?.id
  if (!uid) return { ok: false, error: 'Not signed in.' }

  const { data: cert, error: certErr } = await supabase
    .from('in4_wo_certificates')
    .select('certificate_id, display_no, wo_no, contractor_name, project_id, status_name, outstanding_amt')
    .eq('kind', 'wo')
    .eq('certificate_id', input.certificateId)
    .maybeSingle()

  if (certErr) return { ok: false, error: certErr.message }
  if (!cert) return { ok: false, error: 'That certificate is not in the IN4 mirror. Sync and try again.' }

  const amount = Number(cert.outstanding_amt ?? 0)
  if (!(amount > 0)) {
    return { ok: false, error: 'IN4 shows nothing payable on this certificate, so there is nothing to sanction.' }
  }

  let projectName: string | null = null
  if (cert.project_id != null) {
    const { data: p } = await supabase.from('in4_projects').select('name').eq('id', cert.project_id).maybeSingle()
    projectName = (p?.name as string | undefined) ?? null
  }

  const { error } = await supabase.from('bb_sanctions').insert({
    certificate_id: cert.certificate_id,
    display_no: cert.display_no,
    wo_no: cert.wo_no,
    contractor_name: cert.contractor_name,
    project_name: projectName,
    sanctioned_amount: amount,
    sanctioned_by: uid,
    note: input.note?.trim() || null,
  })

  if (error) {
    // The partial unique index is what stops a double-click, or two people
    // sanctioning the same bill from two screens, becoming two live records.
    if (error.code === '23505') return { ok: false, error: 'This certificate has already been sanctioned.' }
    return { ok: false, error: error.message }
  }

  revalidatePath('/bills-booking/in-flight')
  revalidatePath('/bills-booking/sanctions')
  return { ok: true, amount }
}
