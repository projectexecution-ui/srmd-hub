'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getMyProfile, isPortalOwner } from '@/lib/auth'
import { MANUAL_UPLOAD_KEY } from '@/lib/in4/manual-upload'

/** Switch the manual-upload fallback on or off. Admin or Portal Owner only. */
export async function setManualUpload(on: boolean): Promise<{ ok: boolean; error?: string }> {
  const [profile, owner] = await Promise.all([getMyProfile(), isPortalOwner()])
  if (!profile) return { ok: false, error: 'Sign in first.' }
  const supabase = await createClient()
  if (!(owner || profile.role === 'admin')) {
    const { data: g } = await supabase.from('app_settings').select('value').eq('key', 'in4_manual_upload_users').maybeSingle()
    if (!((g?.value as string | null) ?? '').includes(profile.id)) return { ok: false, error: 'Only an admin, or someone granted it under Admin → People, can switch this.' }
  }
  const { error } = await supabase.from('app_settings').upsert({ key: MANUAL_UPLOAD_KEY, value: on ? 'true' : 'false' }, { onConflict: 'key' })
  if (error) return { ok: false, error: error.code === 'DEMO_READ_ONLY' ? 'This is the trial site — nothing is saved here.' : error.message }
  revalidatePath('/admin/manual-upload')
  revalidatePath('/admin/in4')
  return { ok: true }
}
