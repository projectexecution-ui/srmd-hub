// Notify a SMALL, fixed audience when the Trustee accepts an Internal Estimate.
//
// Internal Estimates ([IB] baseline) are management-confidential and are set
// SILENTLY by the Trustee (cc_set_internal_estimate / the IE-revision import) —
// no notification fires anywhere by default. Aksha asked to be told when it
// happens, but ONLY to a named few: himself, Parimal, and the project's Atm
// Head — never a broadcast. All channels (in-app + email + Telegram-if-
// connected) via notify_user, which respects each recipient's own preferences.
//
// Uses the service role so recipient resolution + notify_user are never blocked
// by the caller's RLS. Best-effort: any failure is swallowed so it can never
// block the Trustee's decision.

import { createClient as createServiceClient } from '@supabase/supabase-js'

// Always-notify people. Kept as emails (self-documenting; survive an id change)
// and resolved to profiles at send time. Edit this list to change who is told.
const IE_FIXED_EMAILS = [
  'projectexecution@construction.srmd.org', // Aksha
  'parimal.srmd@gmail.com',                 // Parimal
]

export interface IeAcceptedInput {
  projectId: string
  /** the Trustee/Admin who accepted — excluded from the recipients. */
  actorId: string | null
  /** 'baseline' = cc_set_internal_estimate accept; 'revision' = revised IB import approved. */
  kind: 'baseline' | 'revision'
  subSkillId?: string | null
  amount?: number | null
  /** revision only — how many sheets were imported. */
  sheets?: number | null
}

export async function notifyInternalEstimateAccepted(input: IeAcceptedInput): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return // no service key (e.g. local) → nothing to send
  const svc = createServiceClient(url, key, { auth: { persistSession: false } })

  try {
    // Labels for the message.
    const [{ data: proj }, subRes] = await Promise.all([
      svc.from('projects').select('code, name').eq('id', input.projectId).maybeSingle(),
      input.subSkillId
        ? svc.from('cc_sub_skills').select('code, name').eq('id', input.subSkillId).maybeSingle()
        : Promise.resolve({ data: null as { code?: string; name?: string } | null }),
    ])
    const projLabel = `${proj?.code ?? ''}${proj?.name ? ` · ${proj.name}` : ''}`.trim() || 'a project'
    const sub = subRes?.data as { code?: string; name?: string } | null
    const workLabel = sub ? `${sub.code ? sub.code + ' ' : ''}${sub.name ?? ''}`.trim() : null

    // Recipients: fixed few + this project's Atm Head (named approver, else the
    // role-wide heads — management only, never all users). Mirrors the existing
    // cc_notify_head_on_approval fallback.
    const ids = new Set<string>()
    const { data: fixed } = await svc.from('profiles').select('id').in('email', IE_FIXED_EMAILS).eq('is_active', true)
    for (const r of fixed ?? []) ids.add((r as { id: string }).id)

    const { data: namedHeads } = await svc
      .from('cc_project_approvers').select('user_id')
      .eq('project_id', input.projectId).eq('role', 'head')
    if ((namedHeads ?? []).length) {
      for (const r of namedHeads!) ids.add((r as { user_id: string }).user_id)
    } else {
      const { data: roleHeads } = await svc.from('profiles').select('id').eq('role', 'head').eq('is_active', true)
      for (const r of roleHeads ?? []) ids.add((r as { id: string }).id)
    }
    if (input.actorId) ids.delete(input.actorId)
    if (ids.size === 0) return

    const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
    const amtStr = input.amount != null && input.amount > 0 ? ` (${inr(input.amount)})` : ''
    const title = input.kind === 'revision'
      ? 'Internal Estimate revised — approved by Trustee'
      : 'Internal Estimate accepted by Trustee'
    const body = input.kind === 'revision'
      ? `The revised Internal Estimate for ${projLabel} was approved by the Trustee and imported${input.sheets ? ` (${input.sheets} sheets)` : ''}${amtStr}.`
      : `The Internal Estimate${workLabel ? ` for ${workLabel}` : ''} on ${projLabel} was accepted by the Trustee${amtStr}.`
    const data = { project: projLabel, work: workLabel, amount: input.amount ?? null, kind: input.kind }

    for (const uid of ids) {
      await svc.rpc('notify_user', {
        p_user_id: uid,
        p_type: 'cc_internal_estimate_accepted',
        p_title: title,
        p_body: body,
        p_url: `/cost-control/projects/${input.projectId}`,
        p_module_slug: 'cost-control',
        p_doc_table: null,
        p_doc_id: null,
        p_data: data,
      })
    }
  } catch { /* best-effort — must never block the decision */ }
}
