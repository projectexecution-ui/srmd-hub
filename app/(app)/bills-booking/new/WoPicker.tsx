'use client'

import { useMemo } from 'react'
import { Label } from '@/components/ui/label'
import { formatINR } from '@/lib/utils'
import type { PickableWo } from '@/lib/bills-booking/wo-picker'

const sel = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm min-h-[44px]'

/** Pick an IN4 project, then an IN4 work order. Everything the work order
 *  already knows is filled in and shown back, rather than typed.
 *
 *  The work-order list is narrowed by project because there are 2,181 of them
 *  and nobody scrolls that. Projects come from IN4 too — the same names the
 *  ERP uses — so a bill cannot be filed against a project IN4 has never heard
 *  of. */
export function WoPicker({
  wos, projects, projectId, woId, onProject, onWo,
}: {
  wos: PickableWo[]
  projects: Array<{ id: number; name: string }>
  projectId: number | null
  woId: number | null
  onProject: (id: number | null) => void
  onWo: (wo: PickableWo | null) => void
}) {
  // Only projects that actually have work orders — the mirror carries 36 and a
  // dozen have never had one.
  const live = useMemo(() => {
    const has = new Set(wos.map(w => w.projectId).filter((x): x is number => x != null))
    return projects.filter(p => has.has(p.id)).sort((a, b) => a.name.localeCompare(b.name))
  }, [wos, projects])

  const forProject = useMemo(
    () => (projectId == null ? [] : wos.filter(w => w.projectId === projectId)),
    [wos, projectId],
  )
  const picked = useMemo(() => wos.find(w => w.woId === woId) ?? null, [wos, woId])

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="in4proj">Project (from IN4) *</Label>
          <select id="in4proj" className={sel} value={projectId ?? ''}
                  onChange={e => { onProject(e.target.value ? Number(e.target.value) : null); onWo(null) }}>
            <option value="">— select a project —</option>
            {live.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="in4wo">Work order (from IN4)</Label>
          <select id="in4wo" className={sel} value={woId ?? ''} disabled={projectId == null}
                  onChange={e => onWo(wos.find(w => w.woId === Number(e.target.value)) ?? null)}>
            <option value="">
              {projectId == null ? '— pick a project first —' : `— ${forProject.length} work orders —`}
            </option>
            {forProject.map(w => (
              <option key={w.woId} value={w.woId}>
                {w.woNo}{w.contractor ? ` · ${w.contractor}` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {picked && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 px-3 py-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700 mb-1.5">
            What IN4 already knows about this work order
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
            <Fact k="Contractor" v={picked.contractor || '—'} />
            <Fact k="Ordered incl. GST" v={formatINR(picked.orderedGross)} />
            <Fact k="Billed so far" v={formatINR(picked.billedGross)} />
            <Fact k="Balance to bill" v={formatINR(picked.balance)} strong />
            <Fact k="Retention on this WO" v={picked.retentionPct == null ? 'no bills yet' : `${picked.retentionPct}%`} />
            <Fact k="Trust" v={picked.trust ?? '—'} />
            <Fact k="Bills so far" v={String(picked.bills)} />
            <Fact k="Last bill no." v={picked.lastBillNo ?? '—'} />
            <Fact k="WO status" v={picked.status ?? '—'} />
          </dl>
          {picked.balance === 0 && (
            <p className="mt-2 text-[11px] font-semibold text-red-700">
              This work order is fully billed. Anything more needs an amendment in IN4 first.
            </p>
          )}
        </div>
      )}
    </>
  )
}

function Fact({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-gray-500">{k}</dt>
      <dd className={`tabular-nums ${strong ? 'font-semibold text-gray-900' : 'text-gray-800'}`}>{v}</dd>
    </div>
  )
}
