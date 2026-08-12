'use server'
// Working-sheet comments — everyone who can SEE a sheet can write on it
// (engineer, Project Head, Atm Head, Trustee, Billing). Visibility is
// enforced by RLS on cc_ws_comments: the insert policy checks the caller
// can select the sheet, so nothing here needs role logic.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { personName } from '@/lib/utils'
import { notifyCommentMentions } from '@/lib/mentions/notify'

export async function addWsComment(
  wsId: string,
  body: string,
  mentionIds: string[] = [],
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { ok: false, error: 'Not signed in' }

  const text = body.trim()
  if (text.length < 1) return { ok: false, error: 'Write something first' }
  if (text.length > 2000) return { ok: false, error: 'Keep comments under 2,000 characters' }

  const { error } = await supabase
    .from('cc_ws_comments')
    .insert({ ws_id: wsId, author_id: auth.user.id, body: text })
  if (error) {
    // RLS rejection reads cryptically — translate for laymen.
    if (/row-level security/i.test(error.message)) {
      return { ok: false, error: 'You do not have access to comment on this sheet' }
    }
    return { ok: false, error: error.message }
  }

  // Notify anyone @mentioned — best effort; a notify failure never fails the comment.
  if (mentionIds.length > 0) {
    try {
      const [{ data: me }, { data: ws }] = await Promise.all([
        supabase.from('profiles').select('full_name, name, email').eq('id', auth.user.id).maybeSingle(),
        supabase.from('cc_working_sheets').select('project_id, sub_skill_id, ws_code').eq('id', wsId).maybeSingle(),
      ])
      let context = ws?.ws_code ?? ''
      if (ws) {
        const [{ data: proj }, { data: sub }] = await Promise.all([
          ws.project_id ? supabase.from('projects').select('code, name').eq('id', ws.project_id).maybeSingle() : Promise.resolve({ data: null as { code: string | null; name: string | null } | null }),
          ws.sub_skill_id ? supabase.from('cc_sub_skills').select('name').eq('id', ws.sub_skill_id).maybeSingle() : Promise.resolve({ data: null as { name: string | null } | null }),
        ])
        const p = proj?.code || proj?.name || ''
        const s = sub?.name || ws.ws_code || ''
        context = [p, s].filter(Boolean).join(' · ')
      }
      await notifyCommentMentions({
        recipientIds: mentionIds,
        authorId: auth.user.id,
        authorName: personName(me?.full_name, me?.name, me?.email),
        body: text,
        moduleSlug: 'cost-control',
        moduleLabel: 'Internal Estimate',
        contextLabel: context,
        url: `/cost-control/working-sheets/${wsId}`,
        docTable: 'cc_working_sheets',
        docId: wsId,
      })
    } catch { /* notify is best-effort */ }
  }

  revalidatePath(`/cost-control/working-sheets/${wsId}`)
  return { ok: true }
}
