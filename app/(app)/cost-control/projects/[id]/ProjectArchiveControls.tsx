'use client'
// Archive (soft) / restore / delete a project, on the project Settings screen.
// Coordinators & CC setup roles can ARCHIVE a mistaken project (reversible,
// hides it from the lists). Only an admin restores it or deletes it for good.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { confirm } from '@/components/ui/confirm-dialog'
import { Archive, RotateCcw, Trash2, Loader2 } from 'lucide-react'
import { setProjectArchived } from './actions'

export function ProjectArchiveControls({
  projectId, projectName, isArchived, canDelete,
}: {
  projectId: string
  projectName: string
  isArchived: boolean
  canDelete: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function archive() {
    if (!(await confirm({
      title: 'Archive this project?',
      message: `"${projectName}" will be hidden from the active lists. Nothing is deleted — an admin can restore it or delete it permanently.`,
      confirmLabel: 'Archive',
    }))) return
    setBusy('archive'); setError(null)
    const res = await setProjectArchived(projectId, true)
    setBusy(null)
    if (!res.ok) { setError(res.error ?? 'Could not archive'); return }
    router.push('/cost-control')
  }

  async function restore() {
    setBusy('restore'); setError(null)
    const res = await setProjectArchived(projectId, false)
    setBusy(null)
    if (!res.ok) { setError(res.error ?? 'Could not restore'); return }
    router.refresh()
  }

  async function del() {
    if (!(await confirm({
      title: 'Delete permanently?',
      message: `"${projectName}" will be permanently removed — this cannot be undone. Setup like disciplines & sub-skills is cleared automatically; it's only blocked if the project has real work (indents, POs, bills, JMR entries or engineer sheets).`,
      confirmLabel: 'Delete forever',
      danger: true,
    }))) return
    setBusy('delete'); setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Name exactly what's blocking, so it's clear what to handle first.
        const blocking = Array.isArray(body.blocking)
          ? body.blocking.filter((b: { count?: number }) => (b.count ?? 0) > 0)
          : []
        const msg = blocking.length
          ? `Can't delete — this project has real work: ${blocking
              .map((b: { label: string; count: number }) => `${b.label} (${b.count})`)
              .join(', ')}. Handle those first, or keep it archived.`
          : (body.error || 'Could not delete this project.')
        setError(msg)
        setBusy(null)
        return
      }
      router.push('/cost-control')
    } catch {
      setError('Could not reach the delete endpoint.')
      setBusy(null)
    }
  }

  return (
    <div className={`rounded-xl border p-4 ${isArchived ? 'border-amber-300 bg-amber-50/50' : 'border-gray-200'}`}>
      <h3 className="text-sm font-semibold text-gray-900 mb-1">{isArchived ? 'Archived project' : 'Archive'}</h3>
      {isArchived ? (
        <>
          <p className="text-xs text-gray-600 mb-3">
            This project is <b>archived</b> — hidden from the active lists.
            {canDelete ? ' Restore it, or delete it permanently.' : ' An admin can restore it or delete it.'}
          </p>
          {canDelete && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={restore} disabled={!!busy} className="h-9">
                {busy === 'restore' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                <span className="ml-1.5">Restore</span>
              </Button>
              <Button variant="outline" onClick={del} disabled={!!busy} className="h-9 text-rose-700 border-rose-200 hover:bg-rose-50">
                {busy === 'delete' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                <span className="ml-1.5">Delete permanently</span>
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-xs text-gray-500 mb-3">
            Created by mistake? Archive it — it&apos;s hidden from the lists (nothing is deleted), and an admin can then restore or permanently delete it.
          </p>
          <Button variant="outline" onClick={archive} disabled={!!busy} className="h-9 text-amber-800 border-amber-200 hover:bg-amber-50">
            {busy === 'archive' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
            <span className="ml-1.5">Archive project</span>
          </Button>
        </>
      )}
      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
    </div>
  )
}
