'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { SlidersHorizontal, Loader2 } from 'lucide-react'

interface Available { code: string; id: string; name: string }

export default function ProjectSettings() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [available, setAvailable] = useState<Available[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  async function openPanel() {
    setOpen(true)
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/bills-pipeline/projects')
      const json = await res.json()
      if (!json.ok) throw new Error(json.reason ?? 'Could not load projects')
      setAvailable(json.available as Available[])
      setSelected(new Set(json.selectedIds as string[]))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load projects')
    } finally {
      setLoading(false)
    }
  }

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function save() {
    const projects = available.filter(p => selected.has(p.id))
    if (projects.length === 0) { toast.error('Select at least one project'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/bills-pipeline/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projects }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.reason ?? 'Save failed')
      toast.success(`Saved — ${json.count} projects. Click Refresh to rebuild the reports.`)
      setOpen(false)
      router.refresh()
    } catch (e) {
      toast.error(`Couldn't save — ${e instanceof Error ? e.message : 'try again'}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button onClick={openPanel} variant="outline" size="sm">
        <SlidersHorizontal className="mr-2 h-4 w-4" />
        Manage projects
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && setOpen(false)}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900">Projects in the reports</h2>
            <p className="mt-1 text-sm text-gray-500">Tick the billing projects to include. Changes apply on the next Refresh.</p>

            <div className="mt-4 max-h-[50vh] space-y-1 overflow-y-auto">
              {loading && (
                <div className="flex items-center gap-2 py-6 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading projects from Zoho…
                </div>
              )}
              {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}
              {!loading && !error && available.map(p => (
                <label key={p.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => toggle(p.id)}
                    className="h-4 w-4 accent-indigo-600"
                  />
                  <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-xs font-semibold text-white">{p.code}</span>
                  <span className="text-sm text-gray-800">{p.name}</span>
                </label>
              ))}
            </div>

            <div className="mt-5 flex items-center justify-between">
              <span className="text-sm text-gray-500">{selected.size} selected</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
                <Button size="sm" onClick={save} disabled={saving || loading}>
                  {saving ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
