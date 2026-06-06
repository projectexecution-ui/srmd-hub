'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MoneyInput } from '@/components/ui/money-input'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Send } from 'lucide-react'

export function NewRequestForm({ projects }: {
  projects: Array<{ id: string; code: string; name: string }>
}) {
  const router = useRouter()
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [title, setTitle]         = useState('')
  const [amount, setAmount]       = useState('')
  const [remarks, setRemarks]     = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr(null)
    if (!title.trim()) { setErr('Title is required'); setBusy(false); return }
    if (!projectId)    { setErr('Pick a project');    setBusy(false); return }

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setErr('Not signed in'); setBusy(false); return }

    // Generate a request number — BD/YYYY/####
    const year = new Date().getFullYear()
    const { count } = await supabase
      .from('blueprint_demo_requests')
      .select('id', { count: 'exact', head: true })
    const seq = String((count ?? 0) + 1).padStart(4, '0')
    const requestNo = `BD/${year}/${seq}`

    const { data: row, error: insertErr } = await supabase
      .from('blueprint_demo_requests')
      .insert({
        request_no: requestNo,
        title: title.trim(),
        project_id: projectId,
        status: 'draft',
        amount: amount ? Number(amount) : 0,
        remarks: remarks.trim() || null,
        created_by: user.id,
      })
      .select('id')
      .single()
    if (insertErr || !row) {
      setErr(insertErr?.message ?? 'Failed to create request')
      setBusy(false)
      return
    }

    // Log the initial state
    await supabase.from('blueprint_demo_request_status_log').insert({
      request_id: row.id,
      from_status: null,
      to_status: 'draft',
      actor_id: user.id,
      remarks: 'Created',
    })

    router.push(`/blueprint-demo/requests/${row.id}`)
    router.refresh()
  }

  if (projects.length === 0) {
    return (
      <p className="text-sm text-gray-600">
        Add at least one <b>project</b> first.
      </p>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {err && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</p>}

      <div>
        <Label>Title *</Label>
        <Input value={title} onChange={e => setTitle(e.target.value)} required placeholder="e.g. extra cement for slab work" className="mt-1" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label>Project *</Label>
          <select value={projectId} onChange={e => setProjectId(e.target.value)} required
            className="mt-1 flex h-10 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
            {projects.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
          </select>
        </div>
        <div>
          <Label>Amount (₹)</Label>
          <MoneyInput value={amount} onChange={setAmount} className="mt-1" />
        </div>
      </div>

      <div>
        <Label>Remarks</Label>
        <Textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} className="mt-1" placeholder="Why this request, what for?" />
      </div>

      <div className="pt-2 border-t border-gray-100">
        <Button type="submit" disabled={busy} className="bg-purple-700 hover:bg-purple-800 text-white">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Create &amp; open
        </Button>
      </div>
    </form>
  )
}
