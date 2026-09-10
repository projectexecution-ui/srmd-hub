'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getMyProfile, isPortalOwner } from '@/lib/auth'
import { MANUAL_UPLOAD_KEY } from '@/lib/in4/manual-upload'

/** Switch the manual-upload fallback on or off. Admin or Portal Owner only. */
export async function setManualUpload(on: boolean): Promise<{ ok: boolean; error?: string }> {
  const [profile, owner] = await Promise.all([getMyProfile(), isPortalOwner()])
  if (!profile || !(owner || profile.role === 'admin')) return { ok: false, error: 'Only an admin can switch this.' }
  const supabase = await createClient()
  const { error } = await supabase.from('app_settings').upsert({ key: MANUAL_UPLOAD_KEY, value: on ? 'true' : 'false' }, { onConflict: 'key' })
  if (error) return { ok: false, error: error.code === 'DEMO_READ_ONLY' ? 'This is the trial site — nothing is saved here.' : error.message }
  revalidatePath('/admin/manual-upload')
  revalidatePath('/admin/in4')
  return { ok: true }
}
