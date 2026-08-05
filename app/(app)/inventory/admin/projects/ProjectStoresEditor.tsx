'use client'
// Map each project to its site store (warehouse) + Atm Head. Auto-saves the
// moment BOTH are chosen (inv_project_setup requires both). Clearing either
// removes the mapping. No separate Save button — like the approval dial.

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Check, Store, ShieldCheck } from 'lucide-react'

export type ProjSetup = { warehouse_id: string; head_id: string }

type Project = { id: string; code: string; name: string }
type Warehouse = { id: string; code: string; name: string; hasKeeper: boolean }
type Head = { id: string; name: string }

export function ProjectStoresEditor({
  projects, warehouses, heads, initial,
}: {
  projects: Project[]
  warehouses: Warehouse[]
  heads: Head[]
  initial: Record<string, ProjSetup>
}) {
  const [state, setState] = useState<Record<string, ProjSetup>>(() => {
    const s: Record<string, ProjSetup> = {}
    for (const p of projects) s[p.id] = initial[p.id] ?? { warehouse_id: '', head_id: '' }
    return s
  })
  const [busy, setBusy] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const setCount = Object.values(state).filter(s => s.warehouse_id && s.head_id).length

  async function persist(projectId: string, next: ProjSetup) {
    setBusy(projectId); setError(null); setSavedAt(null)
    const supabase = createClient()
    if (next.warehouse_id && next.head_id) {
      const { error } = await supabase
        .from('inv_project_setup')
        .upsert(
          { project_id: projectId, primary_warehouse_id: next.warehouse_id, hop_id: next.head_id },
          { onConflict: 'project_id' },
        )
      setBusy(null)
      if (error) { setError(error.message); return }
      setSavedAt(projectId)
    } else if (!next.warehouse_id && !next.head_id) {
      // Both cleared → drop the mapping (back to "not set").
      const { error } = await supabase.from('inv_project_setup').delete().eq('project_id', projectId)
      setBusy(null)
      if (error) { setError(error.message); return }
      setSavedAt(projectId)
    } else {
      // Only one side chosen — hold; the mapping needs both to save.
      setBusy(null)
    }
  }

  function change(projectId: string, patch: Partial<ProjSetup>) {
    const next = { ...state[projectId], ...patch }
    setState(prev => ({ ...prev, [projectId]: next }))
    void persist(projectId, next)
  }

  const selectCls = 'h-10 w-full rounded-lg border border-gray-300 bg-white px-2 text-sm'

  return (
    <div>
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/60">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {setCount} of {projects.length} projects have a store set
        </span>
        {error && <span className="text-xs text-rose-600 font-medium">{error}</span>}
      </div>

      <div className="divide-y divide-gray-100 max-h-[65vh] overflow-y-auto">
        {projects.map(p => {
          const row = state[p.id]
          const complete = !!(row.warehouse_id && row.head_id)
          const partial = !complete && (!!row.warehouse_id || !!row.head_id)
          const wh = warehouses.find(w => w.id === row.warehouse_id)
          return (
            <div key={p.id} className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 md:gap-3 px-4 py-3 items-center">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900 truncate">{p.code}</span>
                  <span className="text-xs text-gray-500 truncate">{p.name}</span>
                  {busy === p.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400 flex-shrink-0" />
                  ) : savedAt === p.id ? (
                    <span className="inline-flex items-center gap-0.5 text-[11px] text-green-700 font-semibold flex-shrink-0"><Check className="h-3 w-3" /> saved</span>
                  ) : null}
                </div>
                {partial && <p className="text-[11px] text-amber-600 mt-0.5">Pick both a store and an Atm Head to save.</p>}
                {complete && wh && !wh.hasKeeper && (
                  <p className="text-[11px] text-amber-600 mt-0.5">This store has no keeper yet — set one on the Warehouses page.</p>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 md:w-[26rem]">
                <label className="block">
                  <span className="sr-only">Store</span>
                  <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-gray-400 mb-0.5"><Store className="h-3 w-3" /> Store</span>
                  <select
                    value={row.warehouse_id}
                    onChange={e => change(p.id, { warehouse_id: e.target.value })}
                    className={selectCls}
                  >
                    <option value="">— none —</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="sr-only">Atm Head</span>
                  <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-gray-400 mb-0.5"><ShieldCheck className="h-3 w-3" /> Atm Head</span>
                  <select
                    value={row.head_id}
                    onChange={e => change(p.id, { head_id: e.target.value })}
                    className={selectCls}
                  >
                    <option value="">— none —</option>
                    {heads.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </select>
                </label>
              </div>
            </div>
          )
        })}
        {projects.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-gray-400">No projects yet.</p>
        )}
      </div>
    </div>
  )
}
