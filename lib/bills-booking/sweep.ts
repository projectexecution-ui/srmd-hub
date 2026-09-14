import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js'
import { checkAll, noticeFor, type Sanction, type In4Cert, type In4Approval, type Check } from './reconcile'

/** The reconciliation sweep.
 *
 *  Reads every live sanction, compares each against the IN4 mirror as it
 *  stands now, writes the verdict back, and tells people about the ones that
 *  changed. Runs on the cron dispatcher, both passes.
 *
 *  Service role, because it writes the verdict columns that no user is allowed
 *  to touch — bb_sanctions has no update policy at all. That is the point: the
 *  verdict has to be something nobody can set by hand.
 *
 *  Idempotent. Running it twice sends nothing the second time: the notice is
 *  gated on the verdict actually changing, and notified_at is stamped as it
 *  goes out. */

function svc(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set — the reconciliation sweep writes with the service role.')
  return createServiceClient(url, key, { auth: { persistSession: false } })
}

export interface SweepResult {
  checked: number
  matched: number
  differs: number
  awaiting: number
  gone: number
  notified: number
  summary: string
}

export async function runReconcileSweep(): Promise<SweepResult> {
  const sb = svc()

  const { data: sanctionRows, error } = await sb
    .from('bb_sanctions')
    .select('id, certificate_id, display_no, sanctioned_amount, sanctioned_at, sanctioned_by, verdict, notified_at')
    .is('superseded_by', null)
  if (error) throw new Error(`bb_sanctions: ${error.message}`)

  const sanctions: Sanction[] = (sanctionRows ?? []).map(r => ({
    id: r.id as string,
    certificateId: r.certificate_id as number,
    displayNo: (r.display_no as string | null) ?? null,
    sanctionedAmount: Number(r.sanctioned_amount ?? 0),
    sanctionedAt: r.sanctioned_at as string,
    verdict: (r.verdict as Sanction['verdict']) ?? null,
    notifiedAt: (r.notified_at as string | null) ?? null,
  }))
  const owner = new Map((sanctionRows ?? []).map(r => [r.id as string, r.sanctioned_by as string | null]))

  if (!sanctions.length) {
    return { checked: 0, matched: 0, differs: 0, awaiting: 0, gone: 0, notified: 0, summary: 'no live sanctions' }
  }

  const ids = sanctions.map(s => s.certificateId)

  const { data: certRows } = await sb
    .from('in4_wo_certificates')
    .select('certificate_id, status_name, outstanding_amt')
    .eq('kind', 'wo').in('certificate_id', ids)
  const certs = new Map<number, In4Cert>((certRows ?? []).map(c => [c.certificate_id as number, {
    certificateId: c.certificate_id as number,
    statusName: (c.status_name as string | null) ?? null,
    payable: Number(c.outstanding_amt ?? 0),
  }]))

  // The first Approved movement per certificate — who keyed it into IN4.
  const { data: evRows } = await sb
    .from('in4_cert_events')
    .select('certificate_id, at, actor_name, status_name')
    .in('certificate_id', ids).eq('status_name', 'Approved')
    .order('at', { ascending: true })
  const approvals = new Map<number, In4Approval>()
  for (const e of evRows ?? []) {
    const id = e.certificate_id as number
    if (!approvals.has(id)) approvals.set(id, { at: e.at as string, actorName: (e.actor_name as string | null) ?? null })
  }

  const checks = checkAll(sanctions, certs, approvals)
  const now = new Date().toISOString()
  let notified = 0

  for (const c of checks) {
    const notice = c.shouldNotify ? noticeFor(c) : null
    if (notice) {
      // Everyone who can administer the module hears about it, plus whoever
      // sanctioned it. An exception report that only reaches the desk it
      // constrains is not a control.
      const to = new Set<string>()
      const mine = owner.get(c.sanctionId)
      if (mine) to.add(mine)
      const { data: admins } = await sb
        .from('profiles').select('id, role').eq('role', 'admin')
      for (const a of admins ?? []) to.add(a.id as string)

      for (const uid of to) {
        // A failed notice must never stop the sweep writing verdicts — the
        // record of what IN4 says matters more than the email about it.
        try {
          await sb.rpc('notify_user', {
            p_user_id: uid,
            p_type: c.verdict === 'matched' ? 'bills_sanction_matched' : 'bills_sanction_mismatch',
            p_title: notice.title,
            p_body: notice.body,
            p_url: '/bills-booking/sanctions',
            p_module_slug: 'bills-booking',
            p_doc_table: 'bb_sanctions',
            p_doc_id: null,
            p_data: {
              certificate: c.displayNo, verdict: c.verdict,
              sanctioned: c.sanctionedAmount, in4: c.in4Amount, difference: c.difference,
            },
          })
        } catch { /* keep going */ }
      }
      notified++
    }

    await sb.from('bb_sanctions').update({
      checked_at: now,
      verdict: c.verdict,
      in4_amount: c.in4Amount,
      in4_status: c.in4Status,
      in4_approved_at: c.in4ApprovedAt,
      in4_approved_by: c.in4ApprovedBy,
      ...(notice ? { notified_at: now } : {}),
    }).eq('id', c.sanctionId)
  }

  const count = (v: Check['verdict']) => checks.filter(c => c.verdict === v).length
  const differs = count('amount_differs')
  const gone = count('gone')
  return {
    checked: checks.length,
    matched: count('matched'),
    differs,
    awaiting: count('awaiting_in4'),
    gone,
    notified,
    summary: `${checks.length} sanctions checked · ${count('matched')} matched · ${differs} differ · ${count('awaiting_in4')} awaiting IN4 · ${gone} gone · ${notified} notices sent`,
  }
}
