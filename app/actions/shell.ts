'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getMyProfile, isPortalOwner } from '@/lib/auth'
import { SHELL_KEY, type ShellMode } from '@/lib/revamp/live'

/**
 * The "CT Hub V1" toggle — Aksha, 10 Sep 2026: "give Admin a Toggle to switch
 * back to previous CT Hub, name it for internal use as CT Hub V1." Admin or
 * Portal Owner only. Writes one app_settings row; every page reads it on its
 * next render (lib/revamp/shell-switch.ts), so the whole hub flips without a
 * deploy. The trial site's proxy refuses this action, as it refuses every write.
 */
export async function setCthubShell(mode: ShellMode): Promise<{ ok: boolean; error?: string }> {
  const [profile, owner] = await Promise.all([getMyProfile(), isPortalOwner()])
  if (!profile || !(owner || profile.role === 'admin')) return { ok: false, error: 'Only an admin can switch the CT Hub version.' }
  if (mode !== 'v1' && mode !== 'v2') return { ok: false, error: 'Unknown version.' }
  const supabase = await createClient()
  const { error } = await supabase.from('app_settings').upsert({ key: SHELL_KEY, value: mode }, { onConflict: 'key' })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/', 'layout')
  return { ok: true }
}
