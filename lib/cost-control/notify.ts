// Cost Control approval notifications (Phase 4). Email-only for now, sent via
// Resend (same as the JMR weekly report). Everything here is BEST-EFFORT and
// gated: it no-ops unless the admin turns on `notify_approvals` AND a
// RESEND_API_KEY is set — so it never blasts mail unexpectedly and never
// breaks the approval action that triggers it.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getCcSettings } from './settings'

export type ApproverRole = 'project_head' | 'head' | 'founder'

const STAGE_LABEL: Record<ApproverRole, string> = {
  project_head: 'Project Head sign-off',
  head: 'Atm Head sign-off',
  founder: 'Trustee release',
}

/** Which approver role covers a sheet at a given status (null = no approver). */
export function coveringApproverRole(status: string): ApproverRole | null {
  switch (status) {
    case 'submitted':          return 'project_head'
    case 'ph_approved':        return 'head'
    case 'atm_approved':
    case 'partially_approved': return 'founder'
    default:                   return null
  }
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://ct-hub.vercel.app'
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

/** Fire a Resend email. Returns false (no throw) if unconfigured. */
export async function sendCcEmail(to: string[], subject: string, html: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  const clean = [...new Set(to.filter(Boolean))]
  if (!key || clean.length === 0) return false
  const from = process.env.RESEND_FROM_EMAIL || 'CT HUB Cost Control <noreply@srmd.org>'
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: clean, subject, html }),
    })
    return r.ok
  } catch {
    return false
  }
}

// Accept any Supabase client — the cron passes a service-role client, the
// approval actions pass the request-scoped server client.
type SB = SupabaseClient

/** Emails of the people who cover (project, role): the project's named
 *  approvers if any, else the base-role holders (role-wide fallback). */
export async function approverEmailsFor(supabase: SB, projectId: string, role: ApproverRole): Promise<string[]> {
  const { data: named } = await supabase
    .from('cc_project_approvers').select('user_id').eq('project_id', projectId).eq('role', role)
  let ids = (named ?? []).map(r => r.user_id as string)
  if (ids.length === 0) {
    const { data: holders } = await supabase
      .from('profiles').select('id').eq('role', role).eq('is_active', true)
    ids = (holders ?? []).map(r => r.id as string)
  }
  if (ids.length === 0) return []
  const { data: profs } = await supabase.from('profiles').select('email').in('id', ids)
  return (profs ?? []).map(p => p.email as string).filter(Boolean)
}

/** Notify the approver(s) a sheet is now waiting on, after a submit/sign-off.
 *  Best-effort; safe to call fire-and-forget. */
export async function notifyApprovalPending(wsId: string): Promise<void> {
  try {
    const settings = await getCcSettings()
    if (!settings.notify_approvals || !process.env.RESEND_API_KEY) return
    const supabase = await createClient()
    const { data: ws } = await supabase
      .from('cc_working_sheets')
      .select('ws_code, status, project_id, total_amount, approved_for_erp_amt, projects(code, name), cc_sub_skills(name)')
      .eq('id', wsId)
      .single()
    if (!ws || !ws.project_id) return
    const role = coveringApproverRole(ws.status as string)
    if (!role) return
    const emails = await approverEmailsFor(supabase, ws.project_id as string, role)
    if (emails.length === 0) return

    const proj = Array.isArray(ws.projects) ? ws.projects[0] : ws.projects
    const sub = Array.isArray(ws.cc_sub_skills) ? ws.cc_sub_skills[0] : ws.cc_sub_skills
    const total = Number(ws.total_amount ?? 0)
    const pending = Math.max(total - Number(ws.approved_for_erp_amt ?? 0), 0)
    const url = `${APP_URL}/cost-control/working-sheets/${wsId}`
    const subject = `Budget waiting for your approval — ${proj?.code ?? ''} · ${sub?.name ?? ''}`.trim()
    const html = `
      <p>A budget is waiting for your <b>${STAGE_LABEL[role]}</b>.</p>
      <p><b>${proj?.code ?? ''} ${proj?.name ?? ''}</b> · ${sub?.name ?? 'Sub-skill'}<br/>
      Sheet <b>${ws.ws_code}</b> · ${inr(role === 'founder' ? pending : total)}${role === 'founder' && pending !== total ? ' balance to release' : ''}</p>
      <p><a href="${url}">Open the working sheet →</a></p>
      <p style="color:#888;font-size:12px">You're receiving this because you're an approver for this project in CT Hub Cost Control.</p>`
    await sendCcEmail(emails, subject, html)
  } catch {
    /* best-effort */
  }
}
