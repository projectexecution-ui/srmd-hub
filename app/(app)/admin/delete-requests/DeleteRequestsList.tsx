'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Loader2, Check, X, ShieldCheck, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Request {
  id: string
  module_slug: string
  doc_table: string
  doc_id: string
  doc_label: string | null
  requested_by: string
  reason: string | null
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  created_at: string
  decided_by: string | null
  decided_at: string | null
  decision_reason: string | null
}

interface ProfileLite {
  id: string
  name: string | null
  full_name: string | null
  email: string
}

export default function DeleteRequestsList({ initial, profiles }: {
  initial: Request[]
  profiles: ProfileLite[]
}) {
  const router = useRouter()
  const [items, setItems] = useState<Request[]>(initial)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reasonDraft, setReasonDraft] = useState<Record<string, string>>({})

  const byId = useMemo(() => new Map(profiles.map(p => [p.id, p])), [profiles])
  function nameFor(id: string | null): string {
    if (!id) return '—'
    const p = byId.get(id)
    return p ? (p.name || p.full_name || p.email) : id.slice(0, 8)
  }

  async function decide(req: Request, decision: 'approved' | 'rejected') {
    setBusyId(req.id); setError(null)
    const reason = reasonDraft[req.id]?.trim() || null
    const supabase = createClient()
    const { error } = await supabase.rpc('act_on_delete_request', {
      p_request_id: req.id,
      p_decision: decision,
      p_reason: reason,
    })
    setBusyId(null)
    if (error) { setError(error.message); return }
    setItems(xs => xs.map(x => x.id === req.id
      ? { ...x, status: decision, decided_at: new Date().toISOString(), decision_reason: reason }
      : x))
    router.refresh()
  }

  const pending  = items.filter(i => i.status === 'pending')
  const decided  = items.filter(i => i.status !== 'pending')

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-rose-600">{error}</p>}

      <Card>
        <CardContent className="pt-5">
          <h2 className="text-base font-bold text-gray-900 mb-3">Pending ({pending.length})</h2>
          {pending.length === 0 ? (
            <p className="text-sm text-gray-500 italic">Nothing pending right now.</p>
          ) : (
            <div className="space-y-3">
              {pending.map(r => {
                const busy = busyId === r.id
                return (
                  <div key={r.id} className="rounded-xl border border-amber-200 bg-amber-50/40 p-3">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">
                          {r.doc_label || `${r.doc_table} · ${r.doc_id.slice(0, 8)}`}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          <Badge variant="secondary" className="text-[10px] mr-1">{r.module_slug}</Badge>
                          <span className="font-mono">{r.doc_table}</span>
                          {' · '}requested by <b>{nameFor(r.requested_by)}</b>
                          {' · '}{new Date(r.created_at).toLocaleString('en-IN')}
                        </p>
                        {r.reason && (
                          <p className="text-xs text-gray-700 mt-1 italic">&ldquo;{r.reason}&rdquo;</p>
                        )}
                      </div>
                    </div>
                    <Input
                      value={reasonDraft[r.id] ?? ''}
                      onChange={e => setReasonDraft(d => ({ ...d, [r.id]: e.target.value }))}
                      placeholder="Decision reason (optional)"
                      disabled={busy}
                      className="text-sm mb-2"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => decide(r, 'approved')}
                        disabled={busy}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                      >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => decide(r, 'rejected')}
                        disabled={busy}
                        className="text-rose-700 border-rose-300 hover:bg-rose-50"
                      >
                        <X className="h-4 w-4" /> Reject
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          <h2 className="text-base font-bold text-gray-900 mb-3">Recently decided ({decided.length})</h2>
          {decided.length === 0 ? (
            <p className="text-sm text-gray-500 italic">Nothing decided yet.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {decided.map(r => (
                <div key={r.id} className="py-2 flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {r.doc_label || `${r.doc_table} · ${r.doc_id.slice(0, 8)}`}
                    </p>
                    <p className="text-xs text-gray-500">
                      {r.module_slug} · requested by {nameFor(r.requested_by)} · {new Date(r.created_at).toLocaleDateString('en-IN')}
                    </p>
                    {r.decision_reason && (
                      <p className="text-xs text-gray-600 mt-0.5 italic">&ldquo;{r.decision_reason}&rdquo;</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <Badge
                      className={cn(
                        'text-[10px]',
                        r.status === 'approved' ? 'bg-emerald-100 text-emerald-800' :
                        r.status === 'rejected' ? 'bg-rose-100 text-rose-800' :
                                                   'bg-gray-100 text-gray-600',
                      )}
                    >
                      {r.status === 'approved' && <Trash2 className="h-3 w-3 mr-0.5 inline" />}
                      {r.status}
                    </Badge>
                    {r.decided_at && <span className="text-[10px] text-gray-400">{new Date(r.decided_at).toLocaleDateString('en-IN')}</span>}
                    {r.decided_by && <span className="text-[10px] text-gray-400">by {nameFor(r.decided_by)}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
