// Tell the Atm Head when IN4 needs them: an indent or PO at Verify, or a
// GRN received. Runs from the cron dispatcher (both slots); every run is
// idempotent. See lib/in4/approvals-watch.ts for the rule.
//
//   GET  (cron, Bearer CRON_SECRET) → read IN4, compare with the memory in
//        app_settings, notify_user() each Atm Head, save the memory.
//   GET ?dry=1 → the same, but reports what WOULD be sent and saves nothing.
//
// Refuses on the read-only trial site: it writes notifications and its own
// memory into the shared database.

import { NextResponse } from 'next/server'
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js'
import { IS_DEMO, DEMO_BLOCKED_MESSAGE } from '@/lib/demo-mode'
import { in4Config } from '@/lib/in4/db'
import { EMPTY_STATE, planNotices, readIn4Watch, type Notice, type WatchState } from '@/lib/in4/approvals-watch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const STATE_KEY = 'in4_approvals_watch'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>

async function readState(supabase: Client): Promise<WatchState> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', STATE_KEY).maybeSingle()
  try {
    const parsed = data?.value ? JSON.parse(String(data.value)) : null
    return parsed && typeof parsed === 'object' ? { ...EMPTY_STATE, ...parsed } : EMPTY_STATE
  } catch { return EMPTY_STATE }
}

/** IN4 sub-project → the CT Hub project(s) it is linked to → their Atm Heads. */
async function headsBySubproject(supabase: Client, subprojectIds: number[]): Promise<Map<number, Array<{ userId: string; ccProjectId: string }>>> {
  const out = new Map<number, Array<{ userId: string; ccProjectId: string }>>()
  if (subprojectIds.length === 0) return out
  const { data: sl } = await supabase.from('in4_subproject_links').select('subproject_id, bph_project_id').in('subproject_id', subprojectIds)
  const bph = [...new Set(((sl ?? []) as Array<{ bph_project_id: string }>).map(r => r.bph_project_id))]
  if (bph.length === 0) return out
  const { data: cl } = await supabase.from('cc_bph_project_links').select('bph_project_id, cc_project_id').in('bph_project_id', bph)
  const cc = [...new Set(((cl ?? []) as Array<{ cc_project_id: string }>).map(r => r.cc_project_id))]
  if (cc.length === 0) return out
  const { data: ap } = await supabase.from('cc_project_approvers').select('project_id, user_id').eq('role', 'head').in('project_id', cc)
  const headsByCc = new Map<string, string[]>()
  for (const r of (ap ?? []) as Array<{ project_id: string; user_id: string }>) headsByCc.set(r.project_id, [...(headsByCc.get(r.project_id) ?? []), r.user_id])
  const ccByBph = new Map<string, string[]>()
  for (const r of (cl ?? []) as Array<{ bph_project_id: string; cc_project_id: string }>) ccByBph.set(r.bph_project_id, [...(ccByBph.get(r.bph_project_id) ?? []), r.cc_project_id])
  for (const r of (sl ?? []) as Array<{ subproject_id: number; bph_project_id: string }>) {
    for (const ccId of ccByBph.get(r.bph_project_id) ?? []) {
      for (const userId of headsByCc.get(ccId) ?? []) {
        const list = out.get(r.subproject_id) ?? []
        if (!list.some(x => x.userId === userId)) list.push({ userId, ccProjectId: ccId })
        out.set(r.subproject_id, list)
      }
    }
  }
  return out
}

export async function GET(req: Request) {
  if (IS_DEMO) return NextResponse.json({ ok: false, error: DEMO_BLOCKED_MESSAGE, demo: true }, { status: 403 })
  const CRON_SECRET = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) return NextResponse.json({ ok: false, reason: 'Unauthorized' }, { status: 401 })
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return NextResponse.json({ ok: false, reason: 'No service key' }, { status: 503 })
  if (!in4Config()) return NextResponse.json({ ok: true, skipped: 'IN4 not configured' })
  const dry = new URL(req.url).searchParams.get('dry') === '1'
  const supabase = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, { auth: { persistSession: false } })

  const state = await readState(supabase)
  const { pending, grns } = await readIn4Watch(state.grnSince)
  const { notices, next } = planNotices(state, pending, grns, new Date().toISOString())

  const heads = await headsBySubproject(supabase, [...new Set(notices.map(x => x.subprojectId).filter((x): x is number => x != null))])
  let sent = 0
  const detail: Array<{ type: Notice['type']; title: string; to: number; skipped?: string; errors?: string[] }> = []
  for (const x of notices) {
    const to = x.subprojectId != null ? (heads.get(x.subprojectId) ?? []) : []
    if (to.length === 0) { detail.push({ type: x.type, title: x.title, to: 0, skipped: x.subprojectId == null ? 'no sub-project on the document' : 'no Atm Head on a linked CT Hub project' }); continue }
    const errors: string[] = []
    if (!dry) {
      for (const h of to) {
        const { error } = await supabase.rpc('notify_user', {
          p_user_id: h.userId, p_type: x.type, p_title: x.title, p_body: x.body,
          p_url: `/project/${h.ccProjectId}/procurement`, p_module_slug: 'procurement-tracker', p_data: x.data,
        })
        if (error) errors.push(error.message); else sent++
      }
    }
    detail.push({ type: x.type, title: x.title, to: to.length, ...(errors.length ? { errors } : {}) })
  }
  if (!dry) {
    await supabase.from('app_settings').upsert({ key: STATE_KEY, value: JSON.stringify(next) }, { onConflict: 'key' })
  }
  return NextResponse.json({ ok: true, dry, pending: pending.length, grns: grns.length, notices: notices.length, sent, detail })
}
