// Server component: shows the approval events for a given doc, oldest
// first. Renders comments inline and exposes attachment links. Drop it
// into any module's detail page like:
//   <ApprovalHistory docTable="inv_requests" docId={id} />

import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Paperclip, MessageSquare, ShieldCheck, X, ArrowRight, History } from 'lucide-react'

interface Attachment {
  name: string
  url: string
  path: string
  size: number
  type: string
}

interface Event {
  id: string
  module_slug: string
  doc_type: string
  from_stage: string
  to_stage: string
  actor_id: string | null
  decision: string
  comment: string | null
  attachments: Attachment[]
  created_at: string
}

interface ActorLite {
  id: string
  name: string | null
  full_name: string | null
  email: string
}

export async function ApprovalHistory({
  docTable, docId,
}: { docTable: string; docId: string }) {
  const supabase = await createClient()
  const { data: events } = await supabase
    .from('approval_events')
    .select('id, module_slug, doc_type, from_stage, to_stage, actor_id, decision, comment, attachments, created_at')
    .eq('doc_table', docTable)
    .eq('doc_id', docId)
    .order('created_at', { ascending: true })

  const rows = (events ?? []) as Event[]
  if (rows.length === 0) return null

  const actorIds = Array.from(new Set(rows.map(r => r.actor_id).filter(Boolean) as string[]))
  const { data: actors } = actorIds.length > 0
    ? await supabase.from('profiles').select('id, name, full_name, email').in('id', actorIds)
    : { data: [] }
  const byActor = new Map((actors ?? []).map(a => [a.id, a as ActorLite]))
  const fmtActor = (id: string | null) => {
    if (!id) return 'System'
    const a = byActor.get(id)
    return a ? (a.name || a.full_name || a.email) : id.slice(0, 8)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <History className="h-5 w-5 text-slate-600" />
          Approval history ({rows.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {rows.map(ev => (
            <li key={ev.id} className="border-l-2 border-gray-200 pl-3 py-1">
              <div className="flex flex-wrap items-baseline gap-1.5 text-sm">
                <DecisionBadge decision={ev.decision} />
                <span className="font-medium text-gray-900">{fmtActor(ev.actor_id)}</span>
                <span className="text-gray-500 text-xs">
                  moved <code className="text-[10px] bg-gray-100 px-1 rounded">{ev.from_stage}</code>
                  <ArrowRight className="h-3 w-3 inline mx-0.5 -mt-0.5 text-gray-400" />
                  <code className="text-[10px] bg-gray-100 px-1 rounded">{ev.to_stage}</code>
                </span>
                <span className="text-gray-400 text-xs ml-auto">
                  {new Date(ev.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              </div>

              {ev.comment && (
                <p className="mt-1 text-sm text-gray-700 flex items-start gap-1.5">
                  <MessageSquare className="h-3.5 w-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                  <span className="whitespace-pre-line">{ev.comment}</span>
                </p>
              )}

              {ev.attachments && ev.attachments.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {ev.attachments.map((a, i) => (
                    <li key={i}>
                      <a href={a.url} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-gray-200 bg-white text-blue-700 hover:bg-blue-50 max-w-xs"
                      >
                        <Paperclip className="h-3 w-3 flex-shrink-0" />
                        <span className="truncate">{a.name}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}

function DecisionBadge({ decision }: { decision: string }) {
  const map: Record<string, { cls: string; icon: React.ReactNode; label: string }> = {
    approved:  { cls: 'bg-emerald-100 text-emerald-800', icon: <ShieldCheck className="h-3 w-3" />, label: 'Approved' },
    rejected:  { cls: 'bg-rose-100 text-rose-800',       icon: <X className="h-3 w-3" />,           label: 'Rejected' },
    returned:  { cls: 'bg-amber-100 text-amber-800',     icon: <ArrowRight className="h-3 w-3" />,  label: 'Returned' },
    submitted: { cls: 'bg-blue-100 text-blue-800',       icon: <ArrowRight className="h-3 w-3" />,  label: 'Submitted' },
    cancelled: { cls: 'bg-gray-100 text-gray-600',       icon: <X className="h-3 w-3" />,           label: 'Cancelled' },
    noted:     { cls: 'bg-slate-100 text-slate-700',     icon: <MessageSquare className="h-3 w-3" />, label: 'Noted' },
  }
  const m = map[decision] ?? { cls: 'bg-gray-100 text-gray-700', icon: null, label: decision }
  return (
    <Badge className={`${m.cls} text-[10px] inline-flex items-center gap-1`}>
      {m.icon}{m.label}
    </Badge>
  )
}
