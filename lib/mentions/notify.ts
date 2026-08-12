// Server-only: notify the people @-mentioned in a comment, through the existing
// notify_user pipeline (in-app bell + email). The message is deliberately
// self-explanatory — WHO tagged you, WHERE, and the actual comment — so the
// recipient knows what's being asked just by reading the notification.

import { createClient as createServiceClient } from '@supabase/supabase-js'

export interface MentionNotifyInput {
  recipientIds: string[]
  authorId: string
  authorName: string
  body: string            // the comment text (becomes the notification body)
  moduleSlug: string      // e.g. 'cost-control'
  moduleLabel: string     // human label, e.g. 'Internal Estimate'
  contextLabel: string    // where, e.g. 'NGH A · 3901 Contractor cost'
  url: string             // deep link to the comment/document
  docTable?: string | null
  docId?: string | null
}

export async function notifyCommentMentions(input: MentionNotifyInput): Promise<number> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!key || !supaUrl) return 0

  const recipients = [...new Set(input.recipientIds)].filter(id => id && id !== input.authorId)
  if (recipients.length === 0) return 0

  const svc = createServiceClient(supaUrl, key, { auth: { persistSession: false } })
  const snippet = input.body.length > 600 ? input.body.slice(0, 600) + '…' : input.body
  const title = `${input.authorName} mentioned you — ${input.moduleLabel}`
  const data = {
    author: input.authorName,
    module: input.moduleLabel,
    context: input.contextLabel,
    comment: snippet,
  }

  let sent = 0
  for (const rid of recipients) {
    try {
      const { error } = await svc.rpc('notify_user', {
        p_user_id: rid,
        p_type: 'comment_mention',
        p_title: title,
        p_body: snippet,
        p_url: input.url,
        p_module_slug: input.moduleSlug,
        p_doc_table: input.docTable ?? null,
        p_doc_id: input.docId ?? null,
        p_data: data,
      })
      if (!error) sent++
    } catch { /* one bad recipient never blocks the rest, nor the comment save */ }
  }
  return sent
}
