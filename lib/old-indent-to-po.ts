// Who may open OLD INDENT TO PO.
//
// Aksha, 21 Sep 2026: "can u make which is only visible to me only - name it
// OLD INDENT TO PO". Then, the same day: "i want to show this one to ambrish".
//
// So it is a NAMED LIST, not a role. Ambrish is an engineer and there are
// three of those; letting the role in would hand it to two people nobody
// asked about. The Accounts lane hit the same wall in September — four people
// hold `head` — and was solved this way, so this follows it rather than
// inventing a second shape: app_settings.old_indent_to_po_users holds user
// ids, an admin is always in, and an empty list means him alone.
//
// ONE rule, shared by the lane in the sidebar and the page's own refusal. The
// Stores lesson written down: hiding a lane was never the whole gate, and two
// copies of "who may see this" is how a section ends up one typed URL wide.

import { getMyProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export const OLD_INDENT_TO_PO_USERS_KEY = 'old_indent_to_po_users'

/** Pure: an admin always; everybody else only if named. */
export function oldIndentAllowed(
  me: { id: string | null; role: string | null },
  allowed: readonly string[],
): boolean {
  if (me.role === 'admin') return true
  return !!me.id && allowed.includes(me.id)
}

/** The named list, from app_settings. A missing or malformed setting reads as
 *  nobody — never as everybody, which is the direction a gate should fail. */
export async function oldIndentViewers(): Promise<string[]> {
  try {
    const supabase = await createClient()
    const { data } = await supabase
      .from('app_settings').select('value').eq('key', OLD_INDENT_TO_PO_USERS_KEY).maybeSingle()
    const parsed = JSON.parse((data?.value as string | undefined) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** The whole question, answered on the server. Used by the layout (to decide
 *  the lane) and by the page (to refuse the URL). */
export async function canOpenOldIndentToPo(): Promise<boolean> {
  const [profile, allowed] = await Promise.all([getMyProfile(), oldIndentViewers()])
  if (!profile) return false
  return oldIndentAllowed({ id: profile.id, role: profile.role ?? null }, allowed)
}

/** The restored V1 file. It lives in public/ but is NOT public: the proxy's
 *  matcher deliberately does not exclude .html, so it needs a signed-in
 *  session like every other page — see the comment at the foot of proxy.ts. */
export const OLD_INDENT_TO_PO_SRC = '/old-indent-to-po.html'
