import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyProfile, getMyUser } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate } from '@/lib/utils'
import { BlueprintDemoActions } from './action-client'

export const dynamic = 'force-dynamic'

const STATUS_TONE: Record<string, string> = {
  draft:     'bg-stone-100 text-stone-700',
  submitted: 'bg-amber-100 text-amber-800',
  review:    'bg-blue-100 text-blue-800',
  approved:  'bg-emerald-100 text-emerald-800',
  closed:    'bg-stone-200 text-stone-600',
  rejected:  'bg-rose-100 text-rose-800',
}

export default async function BlueprintDemoRequestDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requirePermission('blueprint-demo', 'view')
  const [profile, user] = await Promise.all([getMyProfile(), getMyUser()])
  const supabase = await createClient()

  const { data: req } = await supabase
    .from('blueprint_demo_requests')
    .select('*, projects(code, name)')
    .eq('id', id)
    .single()
  if (!req) notFound()

  // Status log — every transition this request has been through
  const { data: log } = await supabase
    .from('blueprint_demo_request_status_log')
    .select('id, from_status, to_status, actor_id, remarks, created_at')
    .eq('request_id', id)
    .order('created_at')

  // Outgoing rules from the current status — the moves this user might be able to take
  const { data: rules } = await supabase
    .from('approval_rules')
    .select('to_stage, approver_role, override_role, sla_hours, requires_remarks')
    .eq('module_slug', 'blueprint-demo')
    .eq('from_stage', req.status)
    .eq('is_active', true)

  const proj = Array.isArray(req.projects) ? req.projects[0] : req.projects

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <PageHeader title={req.request_no} back="/blueprint-demo/requests">
        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full ${STATUS_TONE[req.status] ?? 'bg-stone-100 text-stone-700'}`}>
          {req.status}
        </span>
      </PageHeader>

      <Card>
        <CardContent className="pt-5 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Meta label="Title"   value={req.title} />
          <Meta label="Project" value={proj ? `${proj.code} — ${proj.name}` : '—'} />
          <Meta label="Amount"  value={req.amount != null ? `₹${Number(req.amount).toLocaleString('en-IN')}` : '—'} />
          <Meta label="Created" value={formatDate(req.created_at)} />
          {req.remarks && (
            <div className="col-span-2 md:col-span-4">
              <p className="text-[11px] uppercase tracking-wide text-gray-500">Remarks</p>
              <p className="text-gray-800 whitespace-pre-line">{req.remarks}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Action panel — gated server-side by enforce_approval_via_matrix() trigger.
          The client just renders what's possible from the rules; if the user
          tries something disallowed, the trigger rejects with a friendly error. */}
      <BlueprintDemoActions
        requestId={req.id}
        status={req.status}
        outgoingRules={(rules ?? []).map(r => ({
          to_stage: r.to_stage,
          approver_role: r.approver_role,
          override_role: r.override_role,
          sla_hours: r.sla_hours,
          requires_remarks: r.requires_remarks,
        }))}
        userRole={profile?.role ?? null}
        userId={user?.id ?? null}
      />

      {/* Audit log */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">History</CardTitle>
        </CardHeader>
        <CardContent>
          {(log ?? []).length === 0 ? (
            <p className="text-sm text-gray-500 italic">No events yet.</p>
          ) : (
            <ol className="space-y-2 text-sm">
              {(log ?? []).map(e => (
                <li key={e.id} className="flex items-start gap-3 text-stone-700">
                  <span className="text-stone-400 text-xs w-28 flex-shrink-0">{formatDate(e.created_at)}</span>
                  <div className="min-w-0">
                    <p>
                      {e.from_status ? <span className="text-stone-500">{e.from_status} →</span> : null} <b>{e.to_status}</b>
                    </p>
                    {e.remarks && <p className="text-xs text-stone-500 mt-0.5">{e.remarks}</p>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-gray-800 font-medium">{value}</p>
    </div>
  )
}
