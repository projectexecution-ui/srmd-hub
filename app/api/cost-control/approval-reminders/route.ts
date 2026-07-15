// Daily reminder: email each approver a digest of the budgets still waiting
// on them. Runs from a Vercel cron. Gated three ways — the admin setting
// `cc_notify_approvals`, a RESEND_API_KEY, and a SUPABASE_SERVICE_ROLE_KEY —
// so it quietly no-ops until fully configured. Best-effort throughout.
import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { coveringApproverRole, sendCcEmail, type ApproverRole } from '@/lib/cost-control/notify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PENDING = ['submitted', 'ph_approved', 'atm_approved', 'partially_approved']
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://ct-hub.vercel.app'
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

export async function GET(req: Request) {
  const CRON_SECRET = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ ok: false, reason: 'Unauthorized' }, { status: 401 })
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return NextResponse.json({ ok: false, reason: 'No service key' }, { status: 503 })
  if (!process.env.RESEND_API_KEY) return NextResponse.json({ ok: true, skipped: 'no RESEND_API_KEY' })

  const supabase = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { persistSession: false },
  })

  // Setting must be ON (read with the service client — anon can't see it).
  const { data: setting } = await supabase.from('app_settings').select('value').eq('key', 'cc_notify_approvals').maybeSingle()
  const on = ['true', '1', 'on'].includes((setting?.value ?? '') as string)
  if (!on) return NextResponse.json({ ok: true, skipped: 'notifications off' })

  type Sheet = {
    id: string; ws_code: string; status: string; project_id: string | null
    total_amount: number | null; approved_for_erp_amt: number | null; submitted_at: string | null
    projects: { code: string; name: string } | { code: string; name: string }[] | null
    cc_sub_skills: { name: string } | { name: string }[] | null
  }
  const { data: sheetsRaw } = await supabase
    .from('cc_working_sheets')
    .select('id, ws_code, status, project_id, total_amount, approved_for_erp_amt, submitted_at, projects(code, name), cc_sub_skills(name)')
    .in('status', PENDING)
    .is('archived_at', null)
  const sheets = (sheetsRaw ?? []) as Sheet[]
  if (sheets.length === 0) return NextResponse.json({ ok: true, sheets: 0, sent: 0 })

  // Named approvers per (project, role) + role-holder fallback, in bulk.
  const projectIds = [...new Set(sheets.map(s => s.project_id).filter((x): x is string => !!x))]
  const { data: pa } = projectIds.length
    ? await supabase.from('cc_project_approvers').select('project_id, role, user_id').in('project_id', projectIds)
    : { data: [] as Array<{ project_id: string; role: string; user_id: string }> }
  const named = new Map<string, string[]>()
  for (const r of pa ?? []) {
    const k = `${r.project_id}:${r.role}`
    named.set(k, [...(named.get(k) ?? []), r.user_id as string])
  }
  const { data: holders } = await supabase
    .from('profiles').select('id, role').in('role', ['project_head', 'head', 'founder']).eq('is_active', true)
  const holdersByRole = new Map<string, string[]>()
  for (const h of holders ?? []) holdersByRole.set(h.role as string, [...(holdersByRole.get(h.role as string) ?? []), h.id as string])

  // Fan each sheet out to the user(s) who cover its stage.
  const perUser = new Map<string, Sheet[]>()
  for (const s of sheets) {
    const role = coveringApproverRole(s.status) as ApproverRole | null
    if (!role || !s.project_id) continue
    const ids = named.get(`${s.project_id}:${role}`) ?? holdersByRole.get(role) ?? []
    for (const uid of ids) perUser.set(uid, [...(perUser.get(uid) ?? []), s])
  }
  const uids = [...perUser.keys()]
  if (uids.length === 0) return NextResponse.json({ ok: true, sheets: sheets.length, sent: 0 })
  const { data: profs } = await supabase.from('profiles').select('id, email').in('id', uids)
  const emailById = new Map((profs ?? []).map(p => [p.id as string, p.email as string]))

  const now = Date.now()
  const one = (s: Sheet) => {
    const proj = Array.isArray(s.projects) ? s.projects[0] : s.projects
    const sub = Array.isArray(s.cc_sub_skills) ? s.cc_sub_skills[0] : s.cc_sub_skills
    const amt = Math.max(Number(s.total_amount ?? 0) - Number(s.approved_for_erp_amt ?? 0), 0)
    const days = s.submitted_at ? Math.floor((now - new Date(s.submitted_at).getTime()) / 86400000) : 0
    const overdue = days >= 3 ? ` <b style="color:#b91c1c">· ${days}d waiting</b>` : days > 0 ? ` · ${days}d` : ''
    return `<li><a href="${APP_URL}/cost-control/working-sheets/${s.id}">${proj?.code ?? ''} · ${sub?.name ?? s.ws_code}</a> — ${inr(amt)}${overdue}</li>`
  }

  let sent = 0
  for (const [uid, list] of perUser) {
    const email = emailById.get(uid)
    if (!email) continue
    const html = `
      <p>You have <b>${list.length}</b> budget${list.length === 1 ? '' : 's'} awaiting your approval in CT Hub Cost Control:</p>
      <ul>${list.map(one).join('')}</ul>
      <p><a href="${APP_URL}/cost-control/working-sheets">Open Cost Control →</a></p>`
    if (await sendCcEmail([email], `${list.length} budget${list.length === 1 ? '' : 's'} awaiting your approval`, html)) sent++
  }

  return NextResponse.json({ ok: true, sheets: sheets.length, approvers: perUser.size, sent })
}
