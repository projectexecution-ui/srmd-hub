'use client'
// Project + sub-project builder for the JMR Admin → Projects tab.
//
// Two write paths, both touching public.projects:
//   - Top-level project: insert with parent_project_id = null
//   - Sub-project:       insert with parent_project_id = parent.id
//
// Edit + delete use the existing project pages (the row label is a link
// to /projects/{id}), so we don't duplicate the full edit form here.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Plus, ChevronDown, ChevronRight, Loader2, Pencil } from 'lucide-react'
import Link from 'next/link'
import { ProjectDeleteButton } from '@/components/ProjectDeleteButton'

type Project = {
  id: string
  code: string | null
  name: string
  description: string | null
  status: string | null
  parent_project_id: string | null
}

interface Props {
  tops: Project[]
  childrenBy: Record<string, Project[]>
  canEdit: boolean
}

export function ProjectsBuilder({ tops, childrenBy, canEdit }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [_, startTransition] = useTransition()
  const [expanded, setExpanded] = useState<Set<string>>(new Set(tops.map(t => t.id)))
  const [showNewTop, setShowNewTop] = useState(false)
  const [addingSubFor, setAddingSubFor] = useState<string | null>(null)

  // New project / sub-project state
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggle(id: string) {
    const next = new Set(expanded)
    if (next.has(id)) next.delete(id); else next.add(id)
    setExpanded(next)
  }

  function resetForm() {
    setName(''); setCode(''); setError(null)
  }

  async function createTopLevel(e: React.FormEvent) {
    e.preventDefault()
    if (!name || !code) return
    setSaving(true); setError(null)
    const { error } = await supabase.from('projects').insert({
      name, code, parent_project_id: null, status: 'active',
    })
    setSaving(false)
    if (error) { setError(error.message); return }
    resetForm()
    setShowNewTop(false)
    startTransition(() => router.refresh())
  }

  async function createSub(parentId: string, e: React.FormEvent) {
    e.preventDefault()
    if (!name) return
    setSaving(true); setError(null)
    // projects.code is NOT NULL — if the user didn't type one, derive a
    // code from the parent + sibling count so we never blow up the
    // insert. Falls back to a timestamp if the parent has no code yet.
    let finalCode = code.trim()
    if (!finalCode) {
      const parent = tops.find(t => t.id === parentId)
      const siblingCount = (childrenBy[parentId] || []).length
      const base = (parent?.code || 'SUB').trim()
      finalCode = `${base}-SUB-${siblingCount + 1}`
    }
    const { error } = await supabase.from('projects').insert({
      name, code: finalCode, parent_project_id: parentId, status: 'active',
    })
    setSaving(false)
    if (error) { setError(error.message); return }
    resetForm()
    setAddingSubFor(null)
    startTransition(() => router.refresh())
  }

  return (
    <>
      {canEdit && (
        <div className="mb-3">
          {showNewTop ? (
            <Card className="p-3">
              <form onSubmit={createTopLevel} className="space-y-2">
                <p className="text-sm font-semibold text-gray-800">New top-level project</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <div>
                    <Label className="text-xs">Code *</Label>
                    <Input required value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="e.g. NGH" className="mt-1 h-9 text-sm" />
                  </div>
                  <div className="md:col-span-2">
                    <Label className="text-xs">Name *</Label>
                    <Input required value={name} onChange={e => setName(e.target.value)} placeholder="e.g. New Guest House" className="mt-1 h-9 text-sm" />
                  </div>
                </div>
                {error && <p className="text-xs text-red-600">{error}</p>}
                <div className="flex gap-2 pt-1">
                  <Button type="submit" size="sm" disabled={saving || !name || !code}>
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Add project
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => { setShowNewTop(false); resetForm() }}>Cancel</Button>
                </div>
              </form>
            </Card>
          ) : (
            <Button size="sm" onClick={() => { setShowNewTop(true); resetForm() }}>
              <Plus className="h-4 w-4" /> New top-level project
            </Button>
          )}
        </div>
      )}

      <div className="space-y-2">
        {tops.length === 0 && !showNewTop && (
          <Card className="p-6 text-sm text-gray-500 text-center">
            No projects yet. {canEdit && 'Click "New top-level project" to add one.'}
          </Card>
        )}

        {tops.map(p => {
          const kids = childrenBy[p.id] ?? []
          const open = expanded.has(p.id)
          return (
            <Card key={p.id} className="overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2.5 bg-gray-50/60 border-b border-gray-100">
                <button onClick={() => toggle(p.id)} className="flex items-center gap-2 text-left min-w-0 flex-1">
                  {open ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-500" />}
                  <span className="text-xs font-mono font-bold text-blue-700">{p.code}</span>
                  <span className="text-sm font-semibold text-gray-900 truncate">{p.name}</span>
                  <span className="text-xs text-gray-500">· {kids.length} sub</span>
                </button>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/projects/${p.id}?edit=1`}><Pencil className="h-3.5 w-3.5" /></Link>
                  </Button>
                  {canEdit && (
                    <ProjectDeleteButton projectId={p.id} projectName={`${p.code} — ${p.name}`} />
                  )}
                </div>
              </div>

              {open && (
                <div className="px-3 py-2">
                  {kids.length === 0 && !addingSubFor && (
                    <p className="text-xs text-gray-500 italic py-2">No sub-projects yet.</p>
                  )}
                  {kids.map(k => (
                    <div key={k.id} className="flex items-center justify-between py-1.5 px-1 hover:bg-gray-50 rounded">
                      <Link href={`/projects/${k.id}?edit=1`} className="flex items-center gap-2 text-sm min-w-0 flex-1">
                        <span className="text-xs font-mono text-gray-500 flex-shrink-0">{k.code || '—'}</span>
                        <span className="text-gray-800 truncate hover:underline">{k.name}</span>
                      </Link>
                      {canEdit && (
                        <ProjectDeleteButton projectId={k.id} projectName={`${k.code || ''} ${k.name}`.trim()} />
                      )}
                    </div>
                  ))}

                  {canEdit && (
                    addingSubFor === p.id ? (
                      <form onSubmit={e => createSub(p.id, e)} className="mt-2 p-2 bg-blue-50/40 border border-blue-100 rounded">
                        <p className="text-xs font-semibold text-blue-900 mb-1.5">New sub-project under {p.code}</p>
                        <div className="grid grid-cols-3 gap-2">
                          <Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="Code (opt.)" className="h-8 text-xs" />
                          <Input required value={name} onChange={e => setName(e.target.value)} placeholder="Name e.g. Building A" className="h-8 text-xs col-span-2" />
                        </div>
                        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
                        <div className="flex gap-1.5 mt-2">
                          <Button type="submit" size="sm" disabled={saving || !name}>
                            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Add
                          </Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => { setAddingSubFor(null); resetForm() }}>Cancel</Button>
                        </div>
                      </form>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => { setAddingSubFor(p.id); resetForm() }} className="mt-2 h-7 text-xs">
                        <Plus className="h-3.5 w-3.5" /> Add sub-project
                      </Button>
                    )
                  )}
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </>
  )
}
