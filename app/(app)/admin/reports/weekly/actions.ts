'use server'
// Admin → Messages → Weekly report. Saves the list, the switches and who gets it.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getMyProfile, isPortalOwner } from '@/lib/auth'
import { parseWeeklyConfig, serializeWeeklyConfig, WEEKLY_CONFIG_KEY, WEEKLY_EVENT, type WeeklyConfig, type WeeklyLine } from '@/lib/weekly-report/config'

export type Result = { ok: boolean; message?: string }
const denied: Result = { ok: false, message: 'Only an admin can change this.' }
const fail = (e: { code?: string; message: string }): Result => ({ ok: false, message: e.code === 'DEMO_READ_ONLY' ? 'This is the trial site — nothing is saved here.' : e.message })

async function guard(): Promise<{ id: string } | null> {
  const [profile, owner] = await Promise.all([getMyProfile(), isPortalOwner()])
  if (!profile || !(owner || profile.role === 'admin')) return null
  return { id: profile.id }
}

async function readConfig(supabase: Awaited<ReturnType<typeof createClient>>): Promise<WeeklyConfig> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', WEEKLY_CONFIG_KEY).maybeSingle()
  return parseWeeklyConfig((data?.value as string | null) ?? null)
}
async function writeConfig(supabase: Awaited<ReturnType<typeof createClient>>, cfg: WeeklyConfig): Promise<Result> {
  const { error } = await supabase.from('app_settings').upsert({ key: WEEKLY_CONFIG_KEY, value: serializeWeeklyConfig(cfg) }, { onConflict: 'key' })
  if (error) return fail(error)
  revalidatePath('/admin/reports/weekly'); revalidatePath('/admin/reports')
  return { ok: true }
}

/** The whole list at once — the table is edited locally and saved in one go. */
export async function saveWeeklyLines(lines: WeeklyLine[]): Promise<Result> {
  if (!(await guard())) return denied
  const clean = parseWeeklyConfig(JSON.stringify({ lines })).lines
  if (clean.length === 0) return { ok: false, message: 'The list cannot be empty.' }
  const supabase = await createClient()
  const cfg = await readConfig(supabase)
  return writeConfig(supabase, { ...cfg, lines: clean })
}

export async function setWeeklySwitch(key: 'includeDesign' | 'groupPdfs', on: boolean): Promise<Result> {
  if (!(await guard())) return denied
  const supabase = await createClient()
  const cfg = await readConfig(supabase)
  return writeConfig(supabase, { ...cfg, [key]: on })
}

/**
 * One person, one channel. The first time anyone is touched, the current
 * role-based list is written out so nothing changes for the others; from then
 * on the map is the truth. Per-channel "off" is also written as a user-scope
 * rule so notify_user() honours it whichever screen sends the report.
 */
export async function setWeeklyRecipient(
  userId: string, channel: 'card' | 'email', on: boolean,
  /** The resolved list as the page shows it — needed to materialise the default the first time. */
  current: Array<{ id: string; card: boolean; email: boolean }>,
): Promise<Result> {
  const me = await guard(); if (!me) return denied
  const supabase = await createClient()
  const cfg = await readConfig(supabase)
  const map = cfg.recipients ? { ...cfg.recipients } : Object.fromEntries(current.map(r => [r.id, { card: r.card, email: r.email }]))
  const cur = map[userId] ?? { card: false, email: false }
  map[userId] = { ...cur, [channel]: on }
  const r = await writeConfig(supabase, { ...cfg, recipients: map })
  if (!r.ok) return r

  // Mirror as user-scope rules so notify_user() honours the choice whichever screen
  // sends: "gets it" off = every rule-gated channel off (the route also skips the
  // person entirely, because the Telegram DM is not rule-gated); e-mail = email only.
  const channels = channel === 'card' ? ['in_app', 'email', 'web_push', 'telegram'] : ['email']
  const { error } = on
    ? await supabase.from('notification_rules').delete().eq('scope', 'user').eq('scope_key', userId).eq('event_type', WEEKLY_EVENT).in('channel', channels)
    : await supabase.from('notification_rules').upsert(
        channels.map(c => ({ scope: 'user', scope_key: userId, event_type: WEEKLY_EVENT, channel: c, enabled: false, updated_by: me.id, updated_at: new Date().toISOString() })),
        { onConflict: 'scope,scope_key,event_type,channel' })
  if (error) return fail(error)
  return { ok: true }
}

/** Global channel switch for this report — the same rule row the Messages page writes. */
export async function setWeeklyChannel(channel: 'in_app' | 'email' | 'web_push' | 'telegram', on: boolean): Promise<Result> {
  const me = await guard(); if (!me) return denied
  const supabase = await createClient()
  const { error } = await supabase.from('notification_rules').upsert(
    { scope: 'global', scope_key: '', event_type: WEEKLY_EVENT, channel, enabled: on, updated_by: me.id, updated_at: new Date().toISOString() },
    { onConflict: 'scope,scope_key,event_type,channel' })
  if (error) return fail(error)
  revalidatePath('/admin/reports/weekly'); revalidatePath('/admin/reports'); revalidatePath('/admin/email')
  return { ok: true }
}
