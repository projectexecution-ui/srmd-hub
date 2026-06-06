'use client'
// Action panel for a Blueprint Demo request. Mirrors the inventory
// RequestActions pattern in miniature: pure status-update through
// the matrix-enforcement trigger. The trigger rejects if the user's
// role doesn't match the rule, so the client is permissive — we
// show all outgoing transitions and let the server gate.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, Check, X } from 'lucide-react'
import type { Role } from '@/lib/types'

interface OutgoingRule {
  to_stage: string
  approver_role: string
  override_role: string | null
  sla_hours: number | null
  requires_remarks: boolean
}

const TERMINAL_STATES = new Set(['closed', 'rejected'])
const REJECT_TONE = 'bg-rose-600 hover:bg-rose-700'
const APPROVE_TONE = 'bg-emerald-600 hover:bg-emerald-700'

export function BlueprintDemoActions({
  requestId, status, outgoingRules, userRole, userId,
}: {
  requestId: string
  status: string
  outgoingRules: OutgoingRule[]
  userRole: Role | null
  userId: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [remarks, setRemarks] = useState('')

  // Terminal states have nothing to do
  if (TERMINAL_STATES.has(status)) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-stone-600">
          This request is in a terminal state (<b>{status}</b>). No further actions available.
        </CardContent>
      </Card>
    )
  }

  if (outgoingRules.length === 0) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-stone-600">
          No outgoing transitions configured from <b>{status}</b>. Add a rule at <a href="/blueprint-demo/admin" className="text-purple-700 hover:underline">/blueprint-demo/admin</a>.
        </CardContent>
      </Card>
    )
  }

  async function transition(toStage: string, requiresRemarks: boolean) {
    if (requiresRemarks && !remarks.trim()) {
      setErr('Remarks required for this transition')
      return
    }
    setBusy(true); setErr(null); setMsg(null)
    const supabase = createClient()

    // 1. Update the status. Trigger enforces matrix + RLS.
    const { error: updateErr } = await supabase
      .from('blueprint_demo_requests')
      .update({ status: toStage })
      .eq('id', requestId)
    if (updateErr) {
      setErr(updateErr.message)
      setBusy(false)
      return
    }

    // 2. Log the approval event (audit trail). Best-effort — the
    //    matrix trigger already gated, so the row exists either way.
    const decisionMap: Record<string, string> = {
      submitted: 'submitted',
      review:    'noted',
      approved:  'approved',
      closed:    'noted',
      rejected:  'rejected',
    }
    await supabase.rpc('record_approval_event', {
      p_module_slug: 'blueprint-demo',
      p_doc_type: 'blueprint_demo_request',
      p_doc_table: 'public.blueprint_demo_requests',
      p_doc_id: requestId,
      p_from_stage: status,
      p_to_stage: toStage,
      p_decision: decisionMap[toStage] ?? 'noted',
      p_comment: remarks.trim() || null,
    })

    setMsg(`Moved to ${toStage}.`)
    setBusy(false)
    setTimeout(() => router.refresh(), 500)
  }

  // Show context info: who you are vs who can act here
  const eligibleRoles = new Set(outgoingRules.flatMap(r =>
    [r.approver_role, r.override_role].filter((x): x is string => !!x)))
  const canIAct = userRole && (eligibleRoles.has(userRole) || userRole === 'admin')

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Available transitions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-stone-500">
          Your role: <b className="text-stone-700">{userRole ?? '—'}</b>. Eligible roles for this stage: <b className="text-stone-700">{[...eligibleRoles].join(', ') || '—'}</b>.
          {!canIAct && (
            <span className="block text-amber-700 mt-1">
              You aren&apos;t in the eligible roles &mdash; the server-side trigger will block any action. Admins can always act as a fallback.
            </span>
          )}
        </p>

        <Textarea
          value={remarks}
          onChange={e => setRemarks(e.target.value)}
          rows={2}
          placeholder="Remarks (required for reject)"
        />

        <div className="flex flex-wrap gap-2">
          {outgoingRules.map(rule => {
            const isReject = rule.to_stage === 'rejected'
            const tone = isReject ? REJECT_TONE : APPROVE_TONE
            const Icon = isReject ? X : Check
            return (
              <Button
                key={rule.to_stage}
                onClick={() => transition(rule.to_stage, rule.requires_remarks || isReject)}
                disabled={busy}
                className={`${tone} text-white`}
                title={`${rule.approver_role}${rule.override_role ? ` or ${rule.override_role}` : ''}${rule.sla_hours ? ` · SLA ${rule.sla_hours}h` : ''}`}
              >
                <Icon className="h-4 w-4" /> Move to {rule.to_stage}
              </Button>
            )
          })}
        </div>

        {err && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</p>}
        {msg && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{msg}</p>}
        {busy && <p className="text-sm text-stone-500 inline-flex items-center gap-1.5"><Loader2 className="h-4 w-4 animate-spin" /> Working…</p>}
      </CardContent>
    </Card>
  )
}
