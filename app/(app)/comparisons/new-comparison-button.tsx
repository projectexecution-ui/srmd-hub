'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Plus, X } from 'lucide-react'

interface Project { id: string; code: string; name: string }

export default function NewComparisonButton({ projects, compact }: { projects: Project[]; compact?: boolean }) {
  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [scope, setScope] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { setError('Title is required'); return }
    setBusy(true); setError(null)
    const { data, error } = await supabase
      .from('cmp_comparisons')
      .insert({
        title: title.trim(),
        project_id: projectId || null,
        scope: scope.trim() || null,
      })
      .select('id')
      .single()
    setBusy(false)
    if (error) { setError(error.message); return }
    router.push(`/comparisons/${(data as { id: string }).id}`)
  }

  if (!open) {
    return (
      <Button size={compact ? 'default' : 'sm'} onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> New comparison
      </Button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
      <form
        onSubmit={submit}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5 space-y-3"
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-bold text-gray-900">New comparison</h3>
          <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-700">Title *</label>
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Cement & TMT supply — NGH Block A" autoFocus />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-700">Project</label>
          <select value={projectId} onChange={e => setProjectId(e.target.value)}
            className="h-10 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm">
            <option value="">— No project —</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-700">Scope (optional)</label>
          <Textarea value={scope} onChange={e => setScope(e.target.value)} rows={3} placeholder="What the comparison is for. Visible on the detail page." />
        </div>
        {error && <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1">{error}</p>}
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button type="submit" size="sm" disabled={busy || !title.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create + open
          </Button>
        </div>
      </form>
    </div>
  )
}
