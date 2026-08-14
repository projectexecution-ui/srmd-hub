'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { confirm } from '@/components/ui/confirm-dialog'
import { applyIn4Sync } from '../../actions'
import { GROUP_META } from '@/lib/warehouse/in4-sync'
import type { SyncGroup, SyncPlan } from '@/lib/warehouse/in4-sync'
import { formatQty, formatINR } from '@/lib/warehouse/format'
import { formatDate, formatNumber } from '@/lib/utils'
import {
  ChevronRight, Loader2, Check, AlertTriangle, Info, Database,
} from 'lucide-react'

export function SyncClient({
  plan, slots, lineCount, canAdmin, showValues,
}: {
  plan: SyncPlan
  slots: string[]
  lineCount: number
  canAdmin: boolean
  showValues: boolean
}) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [picked, setPicked] = useState<Set<SyncGroup>>(
    new Set<SyncGroup>(['items', 'units', 'disciplines', 'pos']),
  )
  const [open, setOpen] = useState<SyncGroup | null>(null)

  const counts: Record<SyncGroup, number> = {
    items: plan.items.create.length + plan.items.adopt.length,
    units: plan.units.create.length,
    disciplines: plan.disciplines.create.length,
    pos: plan.pos.create.length,
  }
  const nothingToDo = Object.values(counts).every(n => n === 0)
  const totalPicked = [...picked].reduce((s, g) => s + counts[g], 0)

  function toggle(g: SyncGroup) {
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(g)) next.delete(g); else next.add(g)
      return next
    })
  }

  function apply() {
    start(async () => {
      const chosen = [...picked].filter(g => counts[g] > 0)
      const lines = chosen.map(g => {
        const meta = GROUP_META.find(m => m.key === g)!
        return `• ${counts[g]} ${meta.title.toLowerCase()}`
      })
      const ok = await confirm({
        title: 'Bring this across?',
        message: `${lines.join('\n')}\n\nNothing already in the warehouse is changed or removed. `
          + 'Items you already hold keep their unit, and a purchase order that is already imported is left alone.',
        confirmLabel: 'Bring it across',
        danger: false,
      })
      if (!ok) return
      const res = await applyIn4Sync(chosen)
      if (!res.ok) { toast.error(res.error); return }
      const bits = [
        res.itemsCreated ? `${res.itemsCreated} items added` : '',
        res.itemsAdopted ? `${res.itemsAdopted} existing items linked` : '',
        res.unitsCreated ? `${res.unitsCreated} units` : '',
        res.disciplinesCreated ? `${res.disciplinesCreated} trades` : '',
        res.posCreated ? `${res.posCreated} POs (${res.poLinesCreated} lines)` : '',
        res.ratesSet ? `${res.ratesSet} rates` : '',
      ].filter(Boolean)
      toast.success(bits.length ? `Done — ${bits.join(', ')}.` : 'Nothing needed bringing across.')
      for (const s of res.skipped) toast.info(s)
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-[12px] text-slate-600 flex items-start gap-2">
        <Database className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-slate-400" />
        <span>
          Read from <b>{lineCount.toLocaleString('en-IN')}</b> uploaded lines
          {slots.length > 1 ? ' across both IN4 reports' : ` (${slots.join(', ')})`}.
          {plan.unnamedLines > 0 && <> {plan.unnamedLines} line{plan.unnamedLines === 1 ? '' : 's'} had no material name and cannot become items.</>}
          {' '}Stores are not touched — the uploads have no store in them, and yours are yours.
        </span>
      </div>

      {nothingToDo && (
        <Card className="p-6 text-center shadow-sm">
          <Check className="h-8 w-8 text-emerald-500 mx-auto" />
          <p className="text-sm font-bold text-slate-800 mt-2">Already up to date.</p>
          <p className="text-[12.5px] text-slate-500 mt-1">
            Everything in the current upload is already in the warehouse. Run this again after the next
            IN4 upload.
          </p>
        </Card>
      )}

      {GROUP_META.map(meta => {
        const n = counts[meta.key]
        const on = picked.has(meta.key)
        const isOpen = open === meta.key
        return (
          <Card key={meta.key} className="p-0 shadow-sm overflow-hidden">
            <div className="flex items-start gap-3 p-4">
              <input
                type="checkbox" checked={on} disabled={!canAdmin || n === 0 || busy}
                onChange={() => toggle(meta.key)}
                aria-label={`Bring across ${meta.title}`}
                className="mt-0.5 h-5 w-5 flex-shrink-0 accent-emerald-600"
              />
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-bold text-slate-800">
                  {meta.title}
                  {n === 0
                    ? <span className="ml-2 text-[11px] font-semibold text-emerald-700">nothing new</span>
                    : <span className="ml-2 text-[11px] font-extrabold text-emerald-700">
                        +{formatNumber(n, 0)} new
                      </span>}
                </p>
                <p className="text-[11.5px] text-slate-500 mt-0.5">{meta.what}</p>
                <p className="text-[11px] text-slate-400 mt-1 leading-snug">{meta.safety}</p>
              </div>
              {n > 0 && (
                <button type="button" onClick={() => setOpen(isOpen ? null : meta.key)}
                  aria-expanded={isOpen}
                  className="flex-shrink-0 text-[11.5px] font-bold text-slate-500 hover:text-emerald-700 inline-flex items-center gap-0.5 min-h-[36px]">
                  {isOpen ? 'Hide' : 'See the list'}
                  <ChevronRight className={`h-3.5 w-3.5 transition ${isOpen ? 'rotate-90' : ''}`} />
                </button>
              )}
            </div>

            {isOpen && (
              <div className="border-t border-slate-100 p-4 pt-3">
                {meta.key === 'items' && <ItemsDetail plan={plan} />}
                {meta.key === 'units' && <UnitsDetail plan={plan} />}
                {meta.key === 'disciplines' && <ListDetail values={plan.disciplines.create} />}
                {meta.key === 'pos' && <PosDetail plan={plan} showValues={showValues} />}
              </div>
            )}
          </Card>
        )
      })}

      {/* Everything the plan decided NOT to bring across, so a number that looks
          missing has a reason next to it rather than being a mystery. */}
      <Card className="p-4 shadow-sm">
        <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mb-2">
          Left out on purpose
        </p>
        <div className="space-y-1 text-[12px] text-slate-600">
          <Left n={plan.items.alreadyThere} what="items already in the warehouse" why="left exactly as they are" />
          <Left n={plan.pos.alreadyImported} what="purchase orders already imported" why="never touched again, so nothing already received can change" />
          <Left n={plan.pos.skippedDraft} what="draft POs" why="not issued yet" />
          <Left n={plan.pos.skippedInferred} what="POs the parser guessed" why="IN4 never gave those a number" />
          <Left n={plan.pos.skippedEmpty} what="POs with no usable line" why="no material or no quantity on them" />
          <Left n={plan.unnamedLines} what="lines with no material name" why="nothing to make an item from" />
        </div>
      </Card>

      {(plan.items.unitConflicts.length > 0 || plan.units.synonymGroups.length > 0
        || plan.pos.unmatchedProjects.length > 0 || plan.items.noUom.length > 0) && (
        <Card className="p-4 shadow-sm border-amber-200 bg-amber-50/60 space-y-2.5">
          <p className="text-[12.5px] font-bold text-amber-900 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" /> Worth knowing before you press go
          </p>

          {plan.items.unitConflicts.length > 0 && (
            <Warn title={`${plan.items.unitConflicts.length} items where IN4's unit differs from ours`}>
              Ours is kept — a unit is locked to its item because stock is recorded against it, and changing
              one would re-scale every quantity ever entered. Fix any that matter by hand.
              <ul className="mt-1 space-y-0.5">
                {plan.items.unitConflicts.slice(0, 8).map(c => (
                  <li key={c.name} className="text-[11.5px]">
                    <b>{c.name}</b> — ours <b>{c.ours}</b>, IN4 says <b>{c.in4}</b>
                  </li>
                ))}
                {plan.items.unitConflicts.length > 8 && (
                  <li className="text-[11px] text-amber-800">+{plan.items.unitConflicts.length - 8} more</li>
                )}
              </ul>
            </Warn>
          )}

          {plan.units.synonymGroups.length > 0 && (
            <Warn title="IN4 uses more than one word for the same unit">
              These are added as separate units because which one you want to keep is your call, not a guess
              this should make. Switch the spares off in Settings → Units afterwards.
              <ul className="mt-1 space-y-0.5">
                {plan.units.synonymGroups.map(g => (
                  <li key={g.label} className="text-[11.5px]">
                    <b>{g.label}</b>: {g.members.join(' · ')}
                  </li>
                ))}
              </ul>
            </Warn>
          )}

          {plan.items.noUom.length > 0 && (
            <Warn title={`${plan.items.noUom.length} items where IN4 gave no unit`}>
              Those come in as <b>Nos</b> so they can be received at all — the unit cannot be blank. Correct
              any that are wrong <i>before</i> stock is recorded against them, because it locks after that.
            </Warn>
          )}

          {plan.pos.unmatchedProjects.length > 0 && (
            <Warn title={`Most POs will come in without a project (${plan.pos.unmatchedProjects.length} names do not match)`}>
              IN4 and the hub spell projects differently, so only an exact name match is used —
              <b> deliberately no guessing</b>. The indent number does carry a project code, but on your real
              data that code puts every <i>New Guest House</i> PO against <i>NGH Infra</i>, which is a different
              project. Filing a whole project&apos;s orders in the wrong place is worse than leaving the field
              empty, and it costs nothing: <b>the project is asked for at the gate</b>, when the material
              actually turns up, and that is the figure the reports use.
              <p className="mt-1">
                Not matched: {plan.pos.unmatchedProjects.slice(0, 8).join(', ')}
                {plan.pos.unmatchedProjects.length > 8 ? `, +${plan.pos.unmatchedProjects.length - 8} more` : ''}.
              </p>
            </Warn>
          )}
        </Card>
      )}

      {!nothingToDo && (
        <div className="sticky bottom-3">
          <Card className="p-3 shadow-lg border-emerald-200">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-bold text-slate-800">
                  {totalPicked > 0
                    ? `${formatNumber(totalPicked, 0)} things ticked`
                    : 'Nothing ticked'}
                </p>
                <p className="text-[11px] text-slate-500">
                  Nothing has been written yet. This is the point where it happens.
                </p>
              </div>
              <button type="button" onClick={apply}
                disabled={!canAdmin || busy || totalPicked === 0}
                className="rounded-lg bg-emerald-600 hover:bg-emerald-700 px-4 py-2.5 min-h-[44px] text-sm font-bold text-white disabled:opacity-50 inline-flex items-center justify-center gap-2">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {busy ? 'Bringing across…' : 'Bring it across'}
              </button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

function Left({ n, what, why }: { n: number; what: string; why: string }) {
  if (n === 0) return null
  return (
    <p>
      <b className="tabular-nums text-slate-800">{formatNumber(n, 0)}</b> {what} —{' '}
      <span className="text-slate-500">{why}</span>
    </p>
  )
}

function Warn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="text-[12px] text-amber-900">
      <p className="font-semibold">{title}</p>
      <div className="text-amber-800 leading-snug">{children}</div>
    </div>
  )
}

function ItemsDetail({ plan }: { plan: SyncPlan }) {
  const rows = [...plan.items.adopt, ...plan.items.create]
  return (
    <div className="space-y-2">
      {plan.items.adopt.length > 0 && (
        <p className="text-[11.5px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 flex items-start gap-1.5">
          <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-slate-400" />
          <span>
            <b>{plan.items.adopt.length}</b> of these already exist under the same name — they are LINKED to
            IN4&apos;s name rather than copied, so their stock is not split across two items.
          </span>
        </p>
      )}
      <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-100">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 bg-slate-50">
            <tr className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
              <th className="text-left px-2 py-1.5">Item</th>
              <th className="text-left px-2 py-1.5">Unit</th>
              <th className="text-left px-2 py-1.5">Trade</th>
              <th className="text-left px-2 py-1.5">What happens</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 400).map(i => (
              <tr key={i.key} className="border-t border-slate-50">
                <td className="px-2 py-1.5 text-slate-800">{i.name}</td>
                <td className="px-2 py-1.5 text-slate-600">
                  {i.unit}{i.unitDefaulted && <span className="text-amber-700"> (defaulted)</span>}
                </td>
                <td className="px-2 py-1.5 text-slate-500">{i.discipline ?? '—'}</td>
                <td className="px-2 py-1.5">
                  {i.adoptItemId
                    ? <span className="text-sky-700 font-semibold">linked to the one you have</span>
                    : <span className="text-emerald-700 font-semibold">added</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 400 && (
        <p className="text-[11px] text-slate-500">Showing the first 400 of {formatNumber(rows.length, 0)}.</p>
      )}
    </div>
  )
}

function UnitsDetail({ plan }: { plan: SyncPlan }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {plan.units.create.map(u => (
        <span key={u} className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[12px] font-semibold text-emerald-800">
          {u}
        </span>
      ))}
    </div>
  )
}

function ListDetail({ values }: { values: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map(v => (
        <span key={v} className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[12px] font-semibold text-emerald-800">
          {v}
        </span>
      ))}
    </div>
  )
}

function PosDetail({ plan, showValues }: { plan: SyncPlan; showValues: boolean }) {
  const pos = plan.pos.create
  const lineTotal = pos.reduce((s, p) => s + p.lines.length, 0)
  return (
    <div className="space-y-2">
      <p className="text-[11.5px] text-slate-600">
        {formatNumber(pos.length, 0)} purchase orders, {formatNumber(lineTotal, 0)} lines
        {showValues && plan.rates.pricedLines > 0 && (
          <> · {formatNumber(plan.rates.pricedLines, 0)} lines carry a rate, which also becomes the
             &ldquo;last rate&rdquo; on {formatNumber(plan.rates.itemsWithARate, 0)} items</>
        )}
      </p>
      <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-100 divide-y divide-slate-50">
        {pos.slice(0, 120).map(p => (
          <div key={p.poNo} className="px-2.5 py-2">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="font-mono text-[11.5px] font-bold text-slate-800">{p.poNo}</span>
              {p.poDate && <span className="text-[11px] text-slate-500">{formatDate(p.poDate)}</span>}
              <span className="text-[11.5px] text-slate-700 truncate">{p.vendor ?? 'no vendor named'}</span>
              {p.entity && (
                <span className="text-[9.5px] font-extrabold uppercase rounded-full px-1.5 py-0.5 bg-slate-100 text-slate-600">
                  {p.entity}
                </span>
              )}
              <span className="ml-auto text-[11px] text-slate-500">
                {p.lines.length} {p.lines.length === 1 ? 'line' : 'lines'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {p.projectName ?? 'no project'}
              {p.projectName && !p.projectId && <span className="text-amber-700"> · not matched here</span>}
            </p>
            <div className="mt-1 space-y-0.5">
              {p.lines.slice(0, 4).map(l => (
                <div key={l.itemKey} className="flex items-baseline gap-2 text-[11.5px]">
                  <span className="flex-1 min-w-0 truncate text-slate-700">{l.itemName}</span>
                  <span className="tabular-nums font-semibold text-slate-800">{formatQty(l.qty)}</span>
                  {showValues && (
                    <span className="tabular-nums text-slate-500 w-20 text-right">
                      {l.rate == null ? '—' : formatINR(l.rate)}
                    </span>
                  )}
                </div>
              ))}
              {p.lines.length > 4 && (
                <p className="text-[11px] text-slate-400">+{p.lines.length - 4} more lines</p>
              )}
            </div>
          </div>
        ))}
      </div>
      {pos.length > 120 && (
        <p className="text-[11px] text-slate-500">Showing the first 120 of {formatNumber(pos.length, 0)}.</p>
      )}
    </div>
  )
}
