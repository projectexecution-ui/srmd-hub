'use client'
// Delete-project control with a dependency-aware confirmation modal.
//
// Flow:
//   1. User clicks "Delete" → modal opens, we GET /api/projects/{id} to
//      fetch dep counts.
//   2. If any deps > 0 → show a "Can't delete" panel with the breakdown
//      and suggest Archive instead.
//   3. If all deps = 0 → enable a "Yes, delete permanently" button that
//      fires DELETE /api/projects/{id}.
//
// Server re-checks all deps inside the DELETE handler, so the UI is just
// guidance — even a stale UI cannot delete a project that has history.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Trash2, Loader2, AlertTriangle, X } from 'lucide-react'

type Dep = { table: string; label: string; module: string; count: number }

export function ProjectDeleteButton({ projectId, projectName, redirectTo }: {
  projectId: string
  projectName: string
  redirectTo?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deps, setDeps] = useState<Dep[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function openModal() {
    setOpen(true)
    setLoading(true)
    setError(null)
    setDeps(null)
    try {
      const res = await fetch(`/api/projects/${projectId}`)
      if (!res.ok) throw new Error(`Failed to check dependencies (${res.status})`)
      const data = await res.json()
      setDeps(data.deps as Dep[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  async function doDelete() {
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Delete failed (${res.status})`)
      setOpen(false)
      if (redirectTo) router.push(redirectTo)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  const blocking = (deps ?? []).filter(d => d.count > 0)
  const canDelete = !loading && deps != null && blocking.length === 0

  return (
    <>
      <Button
        type="button" size="sm" variant="outline"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); openModal() }}
        className="text-rose-700 hover:text-rose-800 hover:bg-rose-50 border-rose-200"
      >
        <Trash2 className="h-4 w-4" /> Delete
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <h3 className="text-base font-bold text-gray-900">Delete project</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <p className="text-gray-700">You&apos;re about to delete <span className="font-semibold">{projectName}</span>.</p>

              {loading && (
                <div className="flex items-center gap-2 text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Checking dependencies…
                </div>
              )}

              {!loading && error && (
                <div className="rounded-md bg-rose-50 border border-rose-200 text-rose-800 px-3 py-2 text-xs">
                  {error}
                </div>
              )}

              {!loading && deps && blocking.length > 0 && (
                <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-3">
                  <div className="flex items-start gap-2 mb-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm font-bold text-amber-900">Cannot delete — this project has linked data</p>
                  </div>
                  <ul className="text-xs text-amber-900 space-y-1 ml-6 list-disc">
                    {blocking.map(b => (
                      <li key={b.table}>
                        <span className="font-semibold">{b.count}</span> {b.label}
                        <span className="text-amber-700"> · {b.module}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-amber-800 mt-3 ml-6">
                    To retire this project without losing history, open the project and set its <span className="font-mono">status</span> to <span className="font-mono">archived</span> in the edit form.
                  </p>
                </div>
              )}

              {!loading && canDelete && (
                <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2">
                  <p className="text-xs text-emerald-900">No dependent data found. This delete will be permanent and cannot be undone.</p>
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                type="button"
                size="sm"
                disabled={!canDelete || deleting}
                onClick={doDelete}
                className="bg-rose-600 hover:bg-rose-700 text-white disabled:bg-rose-300"
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Delete permanently
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
