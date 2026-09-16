'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCheck } from 'lucide-react'
import { assignStockProject } from '@/lib/stores/actions'
import { fmtQty } from '@/lib/stores/core'
import { formatNumber } from '@/lib/utils'
import type { UnassignedStock, ProjectOpt } from '@/lib/stores/queries'
import { Field, inputClass, Btn, Notice, Empty, Scroller, GroupedOptions, th, thNum, td, tdNum } from '../ui'

/**
 * Saying whose stock it is.
 *
 * Aksha, 16 Sep 2026: "i will do that assignment - give me Bulk selector to
 * assign - so i can do - just flag me which all are pending to do".
 *
 * His rule is that stock belongs to a PROJECT and may sit in any warehouse —
 * "PO of NGH B Belongs to NGH PRoject - so Eng of NGH Project can call for
 * NGH A,B,C etc Stock". Everything loaded from Odoo arrived without one,
 * because Odoo tracked the shelf and never the project.
 *
 * The list only ever shrinks: material arriving through the gate carries its
 * project from the purchase order, so nothing new lands here. It is a backlog
 * to work down, not a leak to plug — which is why the counter at the top is
 * the point of the screen.
 */
export function WhoseStock({
  rows, projects,
}: {
  rows: UnassignedStock[]
  projects: ProjectOpt[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [store, setStore] = useState('')
  const [q, setQ] = useState('')
  const [projectId, setProjectId] = useState('')
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  const key = (r: UnassignedStock) => `${r.itemId}::${r.locationId ?? ''}`

  const stores = useMemo(
    () => [...new Set(rows.map(r => r.where))].sort((a, b) => a.localeCompare(b)),
    [rows],
  )

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return rows.filter(r => {
      if (store && r.where !== store) return false
      if (words.length === 0) return true
      const hay = `${r.itemName} ${r.where} ${r.unit}`.toLowerCase()
      return words.every(w => hay.includes(w))
    })
  }, [rows, store, q])

  const allShownTicked = shown.length > 0 && shown.every(r => ticked.has(key(r)))

  const toggle = (k: string) => setTicked(prev => {
    const next = new Set(prev)
    if (next.has(k)) next.delete(k); else next.add(k)
    return next
  })

  const toggleAllShown = () => setTicked(prev => {
    const next = new Set(prev)
    if (allShownTicked) for (const r of shown) next.delete(key(r))
    else for (const r of shown) next.add(key(r))
    return next
  })

  if (rows.length === 0) {
    return (
      <Empty
        title="Every line of stock says which project it belongs to"
        hint="Material arriving through the gate carries its project from the purchase order, so nothing new appears here."
      />
    )
  }

  const chosen = rows.filter(r => ticked.has(key(r)))

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[15px] font-bold text-gray-900">Whose stock is it</h2>
        <p className="text-[12.5px] text-gray-500 mt-0.5 max-w-2xl">
          Stock belongs to a project and can sit in any warehouse. These lines came in without one —
          everything loaded from Odoo, which tracked the shelf and never the project. Tick what belongs
          together, pick the project, assign. Nothing already assigned is ever touched.
        </p>
      </div>

      {/* The flag he asked for: what is left, and where it is. */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5">
        <p className="text-[13px] font-bold text-amber-900">
          {formatNumber(rows.length, 0)} line{rows.length === 1 ? '' : 's'} still to assign
        </p>
        <p className="text-[12px] text-amber-900/80 mt-0.5">
          {stores.map(s => {
            const n = rows.filter(r => r.where === s).length
            return `${s} (${formatNumber(n, 0)})`
          }).join(' · ')}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="block text-[10.5px] font-bold uppercase tracking-wider text-gray-500 mb-1">Store</span>
          <select className={`${inputClass} max-w-[260px]`} value={store} onChange={e => setStore(e.target.value)}>
            <option value="">Every store</option>
            {stores.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="block flex-1 min-w-[180px] max-w-sm">
          <span className="block text-[10.5px] font-bold uppercase tracking-wider text-gray-500 mb-1">Find</span>
          <input
            type="search" className={inputClass} value={q} onChange={e => setQ(e.target.value)}
            placeholder="Part of an item name"
          />
        </label>
        <Btn kind="ghost" onClick={toggleAllShown}>
          <CheckCheck className="h-4 w-4" />
          {allShownTicked ? 'Untick these' : `Tick all ${formatNumber(shown.length, 0)}`}
        </Btn>
      </div>

      {/* The assign bar. It stays put while you scroll a long list, and says
          exactly what is about to happen — a bulk action that does not name
          its own size is how the wrong 400 rows get moved. */}
      <div className="rounded-xl border border-gray-200 bg-white p-3.5 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="These belong to">
            <select
              className={`${inputClass} min-w-[240px]`} value={projectId}
              onChange={e => setProjectId(e.target.value)}
            >
              <option value="">Pick the project</option>
              <GroupedOptions rows={projects} />
            </select>
          </Field>
          <Btn
            busy={pending}
            disabled={chosen.length === 0 || !projectId}
            onClick={() => start(async () => {
              const r = await assignStockProject({
                lines: chosen.map(c => ({ itemId: c.itemId, locationId: c.locationId })),
                projectId,
              })
              setResult(r)
              if (r.ok) { setTicked(new Set()); router.refresh() }
            })}
          >
            Assign {chosen.length > 0 ? formatNumber(chosen.length, 0) : ''} line{chosen.length === 1 ? '' : 's'}
          </Btn>
        </div>

        {/* Never a dead button with no reason beside it. */}
        {(chosen.length === 0 || !projectId) && (
          <p className="text-[12px] text-gray-500">
            {chosen.length === 0 ? 'Tick the lines that belong to one project.' : 'Pick the project they belong to.'}
          </p>
        )}
        {result && <Notice kind={result.ok ? 'ok' : 'bad'}>{result.message}</Notice>}
      </div>

      {shown.length === 0 ? (
        <Empty title="Nothing matches that" hint="Clear the store filter, or try fewer letters." />
      ) : (
        <>
          <Scroller min={640}>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={th} style={{ width: 40 }}></th>
                  <th className={th}>Item</th>
                  <th className={th}>Where it sits</th>
                  <th className={thNum}>In hand</th>
                  <th className={th}>Unit</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(r => {
                  const k = key(r)
                  return (
                    <tr key={k} className={ticked.has(k) ? 'bg-indigo-50/60' : ''}>
                      <td className={td}>
                        <input
                          type="checkbox" className="h-5 w-5 accent-indigo-700"
                          checked={ticked.has(k)} onChange={() => toggle(k)}
                          aria-label={`${r.itemName} at ${r.where}`}
                        />
                      </td>
                      <td className={td}>{r.itemName}</td>
                      <td className={td}>{r.where}</td>
                      <td className={`${tdNum} font-semibold`}>{fmtQty(r.qty)}</td>
                      <td className={td}>{r.unit}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Scroller>

          {/* Phone: the same rows as tappable cards. */}
          <p className="text-[11.5px] text-gray-500">
            Showing {formatNumber(shown.length, 0)} of {formatNumber(rows.length, 0)}.
            Assigning writes the project onto the stock movements themselves, so the stock screen and this
            list can never disagree about whose it is.
          </p>
        </>
      )}
    </div>
  )
}
