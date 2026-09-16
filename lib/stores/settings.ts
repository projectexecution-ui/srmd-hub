import 'server-only'
import { createClient } from '@/lib/supabase/server'

/**
 * The one thing about this section an admin can change without a deploy.
 *
 * Aksha, 16 Sep 2026: "i want to know about if i want to make toggle Cross
 * Project request admin should be able to on and off the same whenever
 * requred". One switch, and it turns on a whole behaviour rather than storing
 * a value — which is the rule he set after the last module shipped a setting
 * that changed nothing:
 *
 *   OFF  a site asks for its own family's stock only. No approval: the
 *        request lands on the storekeeper already approved.
 *   ON   other families' stock becomes visible and askable. Those requests go
 *        to Mayank (Civil & Finishes) or Kanti (MEP) first, borrowed material
 *        is forced returnable, and the lending project's Atm Head is told what
 *        is out and when it comes back.
 *
 * Stored in `app_settings`, the same key/value table every other module's
 * settings live in, so there is no new table to back up or explain.
 */
export const CROSS_PROJECT_KEY = 'mio_cross_project'

/** OFF unless the row says otherwise. A missing setting must never be the
 *  permissive answer — that is how a paused feature quietly turns itself on
 *  after a restore. */
export async function crossProjectOn(): Promise<boolean> {
  try {
    const supabase = await createClient()
    const { data } = await supabase
      .from('app_settings').select('value').eq('key', CROSS_PROJECT_KEY).maybeSingle()
    return (data?.value as string | undefined) === 'on'
  } catch {
    return false
  }
}
