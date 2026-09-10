// The "Manual upload (IN4 fallback)" switch.
//
// Aksha, 10 Sep 2026: "keep a toggle option for Admin — if the live IN4 auto-read
// fails, I can just switch the toggle on and upload all required sheets in one
// place." While it is on, the IN4 budget, contractor and supplier feeds run in
// shadow mode (they read and compare but do not write), so a hand upload is
// not overwritten at the next sync. Off by default; one app_settings row.

import type { SupabaseClient } from '@supabase/supabase-js'

export const MANUAL_UPLOAD_KEY = 'in4_manual_upload'

export async function readManualUpload(sb: Pick<SupabaseClient, 'from'>): Promise<boolean> {
  try {
    const { data } = await sb.from('app_settings').select('value').eq('key', MANUAL_UPLOAD_KEY).maybeSingle()
    return String(data?.value ?? 'false') === 'true'
  } catch {
    return false
  }
}
