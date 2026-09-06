'use server'
// The one write behind "Who receives what": a recipient list, an assignment
// map or an on/off switch, saved into the same app_settings key the module's
// own screen and cron already read — so nothing about how a message is sent
// changes, only where it is edited. The key must be one the catalogue names.

import { revalidatePath } from 'next/cache'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getMyProfile, isPortalOwner } from '@/lib/auth'
import { recipientSettingKeys } from '@/lib/notifications/catalog'

const ALLOWED = new Set(recipientSettingKeys())

async function requireAdmin(): Promise<string | null> {
  const [profile, owner] = await Promise.all([getMyProfile(), isPortalOwner()])
  if (!profile) return 'Not signed in.'
  if (!(owner || profile.role === 'admin')) return 'Only an admin can change who receives what.'
  return null
}

export async function saveRecipientSetting(key: string, value: string): Promise<{ ok: boolean; error?: string }> {
  const denied = await requireAdmin()
  if (denied) return { ok: false, error: denied }
  if (!ALLOWED.has(key)) return { ok: false, error: `"${key}" is not a recipient setting.` }
  if (value.length > 20_000) return { ok: false, error: 'That list is too long.' }
  const sb = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const { error } = await sb.from('app_settings').upsert({ key, value }, { onConflict: 'key' })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/notifications/recipients')
  revalidatePath('/bills-pipeline/digest-settings')
  revalidatePath('/procurement-tracker/admin')
  revalidatePath('/inventory/admin/settings')
  revalidatePath('/jmr/admin/settings')
  return { ok: true }
}
