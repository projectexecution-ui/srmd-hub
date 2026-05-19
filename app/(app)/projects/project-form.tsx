'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2 } from 'lucide-react'
import type { Project } from '@/lib/types'

interface Props {
  initial?: Partial<Project>
  projectId?: string
}

export function ProjectForm({ initial, projectId }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [p, setP] = useState({
    code: initial?.code ?? '',
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    status: initial?.status ?? 'active',
  })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const supabase = createClient()

    if (projectId) {
      const { error } = await supabase.from('projects').update(p).eq('id', projectId)
      if (error) { setError(error.message); setSaving(false); return }
      router.push(`/projects/${projectId}`)
    } else {
      const { data, error } = await supabase.from('projects').insert(p).select('id').single()
      if (error) { setError(error.message); setSaving(false); return }
      router.push(`/projects/${data.id}`)
    }
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label>Code *</Label>
          <Input value={p.code} onChange={e => setP({ ...p, code: e.target.value })} required placeholder="e.g. NGH" className="mt-1 font-mono" />
        </div>
        <div>
          <Label>Status</Label>
          <select
            value={p.status ?? 'active'}
            onChange={e => setP({ ...p, status: e.target.value })}
            className="mt-1 flex h-10 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="active">Active</option>
            <option value="on_hold">On hold</option>
            <option value="completed">Completed</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      </div>
      <div>
        <Label>Name *</Label>
        <Input value={p.name} onChange={e => setP({ ...p, name: e.target.value })} required placeholder="e.g. New Guest House" className="mt-1" />
      </div>
      <div>
        <Label>Description</Label>
        <Textarea value={p.description ?? ''} onChange={e => setP({ ...p, description: e.target.value })} rows={3} className="mt-1" />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-2 pt-2">
        <Button type="submit" disabled={saving || !p.code || !p.name}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {projectId ? 'Save changes' : 'Create project'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  )
}
