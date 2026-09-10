// Server half of the "CT Hub V1" toggle: read app_settings.cthub_shell once per
// request. Zero cost to a page when the row is absent (one small select, cached).
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { revampFromSetting, SHELL_KEY, type ShellMode } from './live'

/** Does THIS request show the revamp? Trial: always. Live: unless an admin switched CT Hub V1 on. */
export const getRevampOn = cache(async (): Promise<boolean> => {
  try {
    const supabase = await createClient()
    const { data } = await supabase.from('app_settings').select('value').eq('key', SHELL_KEY).maybeSingle()
    return revampFromSetting((data?.value as string | null) ?? null)
  } catch {
    // A read that failed must never decide the shell for everyone — fall back to the master.
    return revampFromSetting(null)
  }
})

export async function getShellMode(): Promise<ShellMode> {
  return (await getRevampOn()) ? 'v2' : 'v1'
}
