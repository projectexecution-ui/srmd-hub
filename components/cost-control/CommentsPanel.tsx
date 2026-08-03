// Working-sheet comments — async server component (drops into any WS
// detail branch, like ApprovalTimeline). Newest LAST so the thread reads
// top-to-bottom; every stakeholder on the sheet can read + write.

import { createClient } from '@/lib/supabase/server'
import { personName } from '@/lib/utils'
import { getRoleLabels } from '@/lib/role-labels'
import type { Role } from '@/lib/types'
import { MessageSquare } from 'lucide-react'
import { AddCommentForm } from './AddCommentForm'

interface CommentRow {
  id: string
  author_id: string | null
  body: string
  created_at: string
}

function fmtWhen(ts: string): string {
  return new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
}

export async function CommentsPanel({ wsId }: { wsId: string }) {
  const supabase = await createClient()

  const { data } = await supabase
    .from('cc_ws_comments')
    .select('id, author_id, body, created_at')
    .eq('ws_id', wsId)
    .order('created_at', { ascending: true })
  const comments = (data ?? []) as CommentRow[]

  // Resolve author names + role chips in one pass.
  const ids = Array.from(new Set(comments.map(c => c.author_id).filter((x): x is string => !!x)))
  const authorById = new Map<string, { name: string; role: string | null }>()
  if (ids.length > 0) {
    const [{ data: profs }, roleLabels] = await Promise.all([
      supabase.from('profiles').select('id, full_name, name, email, role').in('id', ids),
      getRoleLabels(),
    ])
    for (const p of profs ?? []) {
      authorById.set(p.id as string, {
        name: personName(p.full_name, p.name, p.email),
        role: p.role ? (roleLabels[p.role as Role]?.label ?? String(p.role)) : null,
      })
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="px-4 py-2.5 border-b border-gray-100">
        <h3 className="text-sm font-bold text-gray-900 inline-flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-gray-500" /> Comments
        </h3>
        <p className="text-[11px] text-gray-500">Anyone on this sheet — engineer, approvers, billing — can write here.</p>
      </div>

      <div className="p-4 space-y-3">
        {comments.length === 0 ? (
          <p className="text-sm text-gray-400">No comments yet.</p>
        ) : (
          <ul className="space-y-3">
            {comments.map(c => {
              const a = c.author_id ? authorById.get(c.author_id) : null
              return (
                <li key={c.id} className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <p className="text-xs font-semibold text-gray-900">
                      {a?.name ?? 'Someone'}
                      {a?.role && (
                        <span className="ml-1.5 text-[10px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-full px-1.5 py-0.5">
                          {a.role}
                        </span>
                      )}
                    </p>
                    <time className="text-[10px] text-gray-400 whitespace-nowrap">{fmtWhen(c.created_at)}</time>
                  </div>
                  <p className="mt-1 text-sm text-gray-700 whitespace-pre-line break-words">{c.body}</p>
                </li>
              )
            })}
          </ul>
        )}

        <AddCommentForm wsId={wsId} />
      </div>
    </div>
  )
}
