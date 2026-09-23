'use server'

// Data › From IN4 — bring chosen IN4 sub-projects into the hub, or skip them.
// Gate: an admin, or anyone named under People › Powers › "Bring in from
// IN4" (Aksha, 23 Sep 2026: "admin and parimal as well").

import { revalidatePath } from 'next/cache'
import { getMyProfile, isPortalOwner } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { GRANT_KEYS } from '@/lib/revamp/people-grants'
import { intakeServiceClient, adoptSubprojects, skipSubprojects } from '@/lib/in4/intake.server'

export async function canBringInFromIn4(): Promise<{ ok: boolean; userId: string | null }> {
  const [profile, owner] = await Promise.all([getMyProfile(), isPortalOwner()])
  if (!profile) return { ok: false, userId: null }
  if (owner || profile.role === 'admin') return { ok: true, userId: profile.id }
  const supabase = await createClient()
  const { data } = await supabase.from('app_settings').select('value').eq('key', GRANT_KEYS.intake).maybeSingle()
  const named = ((data?.value as string | null) ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return { ok: named.includes(profile.id), userId: profile.id }
}

function afterChange() {
  revalidatePath('/admin/data')
  revalidatePath('/admin')
  revalidatePath('/cost-control')
}

export async function bringInFromIn4(ids: number[]): Promise<{ ok: boolean; added: number; groupsCreated: number; error?: string }> {
  const gate = await canBringInFromIn4()
  if (!gate.ok) return { ok: false, added: 0, groupsCreated: 0, error: 'Only an admin, or someone given “Bring in from IN4” under People › Powers, can do this.' }
  const sb = intakeServiceClient()
  if (!sb) return { ok: false, added: 0, groupsCreated: 0, error: 'The server has no service key set, so it cannot write the links.' }
  const clean = ids.filter(n => Number.isInteger(n) && n > 0).slice(0, 200)
  const r = await adoptSubprojects(sb, clean, gate.userId, `brought in by hand, ${new Date().toISOString().slice(0, 10)}`)
  afterChange()
  return { ok: !r.error, added: r.added, groupsCreated: r.groupsCreated, error: r.error }
}

export async function skipFromIn4(ids: number[]): Promise<{ ok: boolean; skipped: number; error?: string }> {
  const gate = await canBringInFromIn4()
  if (!gate.ok) return { ok: false, skipped: 0, error: 'Only an admin, or someone given “Bring in from IN4” under People › Powers, can do this.' }
  const sb = intakeServiceClient()
  if (!sb) return { ok: false, skipped: 0, error: 'The server has no service key set.' }
  const r = await skipSubprojects(sb, ids.filter(n => Number.isInteger(n) && n > 0).slice(0, 200), gate.userId)
  afterChange()
  return { ok: !r.error, skipped: r.skipped, error: r.error }
}
