'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { savePo } from '../actions'
import { formatDate } from '@/lib/utils'
import { formatQty, formatINR } from '@/lib/warehouse/format'
import type { TrackerPo, TrackerPoSummary } from '@/lib/warehouse/po-import'
import { Search, Loader2, Download, Check, AlertTriangle, Sparkles } from 'lucide-react'

const inputCls =
  'w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm bg-white min-h-[40px] ' +
  'focus:outline-none focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400'

export function PoImportClient({
  q, available, picked, projects, canEdit,
}: {
  q: string
  available: TrackerPoSummary[]
  picked: TrackerPo | null
  projects: Array<{ id: string; name: string }>
  canEdit: boolean
}) {
  const router = useRouter()
  const [search, setSearch] = useState(q)
  const [entity, setEntity] = useState('')
  const [projectId, setProjectId] = useState('')
  const [pending, start] = useTransition()

  function open(poNo: string) {
    router.push(`/warehouse/po?q=${encodeURIComponent(search)}&po=${encodeURIComponent(poNo)}`)
  }

  function importPo() {
    if (!picked) return
    start(async () => {
      const res = await savePo({
        poNo: picked.poNo,
        poDate: picked.poDate,
        vendor: picked.vendor,
        entity: entity || null,
        projectId: projectId || null,
        indentNo: picked.indentNos[0] ?? null,
        source: 'tracker',
        lines: picked.lines.map(l => ({
          material: l.material,
          uom: l.uom,
          orderedQty: l.orderedQty,
          // Carried across so a PO already delivered in IN4 does not arrive here
          // looking untouched. Dropping this is what let 1.37 million already-
          // received units read as "still to come".
          receivedQty: l.receivedQty,
          rate: l.rate,
          discipline: l.discipline,
        })),
      })
      if (!res.ok) { toast.error(res.error); return }
      toast.success(
        `${res.poNo} imported — ${res.lines} ${res.lines === 1 ? 'line' : 'lines'}`
        + (res.itemsCreated ? `, ${res.itemsCreated} new ${res.itemsCreated === 1 ? 'item' : 'items'}` : '')
        + (res.skipped ? `. ${res.skipped} IN4 ${res.skipped === 1 ? 'line was' : 'lines were'} unusable and skipped.` : ''),
      )
      router.push('/warehouse/po')
    })
  }

  return (
    <div className="space-y-3">
      <Card className="p-3 shadow-sm">
        <form
          onSubmit={e => { e.preventDefault(); router.push(`/warehouse/po?q=${encodeURIComponent(search)}`) }}
          className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input type="search" className={inputCls + ' pl-8'} value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="PO number or vendor, as it is in IN4" />
          </div>
          <button type="submit"
            className="rounded-lg border-2 border-slate-200 px-4 py-2 min-h-[40px] text-[12.5px] font-bold text-slate-600 hover:border-emerald-300 hover:text-emerald-700">
            Find
          </button>
        </form>
      </Card>

      {!picked && (
        <div>
          <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mb-2">
            In the Indent → PO Tracker
          </h3>
          {available.length === 0 ? (
            <Card className="p-6 text-center text-sm text-slate-500 shadow-sm">
              No PO matches. The tracker is filled by the weekly IN4 upload on the Indent → PO Tracker screen.
            </Card>
          ) : (
            <Card className="p-0 shadow-sm overflow-hidden divide-y divide-slate-50">
              {available.map(p => (
                <button key={p.poNo} type="button" onClick={() => open(p.poNo)}
                  disabled={p.imported}
                  className="w-full text-left px-3 py-2.5 min-h-[44px] hover:bg-slate-50 disabled:opacity-60 disabled:hover:bg-transparent">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-mono text-[12.5px] font-bold text-slate-800">{p.poNo}</span>
                    {p.imported && (
                      <span className="text-[9.5px] font-extrabold uppercase rounded-full px-2 py-0.5 bg-emerald-100 text-emerald-700">
                        already imported
                      </span>
                    )}
                    <span className="text-[12px] text-slate-600 min-w-0 truncate">{p.vendor ?? '—'}</span>
                    <span className="ml-auto text-[11.5px] text-slate-500">
                      {p.lineCount} {p.lineCount === 1 ? 'line' : 'lines'}
                      {p.poDate ? ` · ${formatDate(p.poDate)}` : ''}
                    </span>
                  </div>
                  {p.project && <div className="text-[11px] text-slate-500 mt-0.5">{p.project}</div>}
                </button>
              ))}
            </Card>
          )}
        </div>
      )}

      {picked && (
        <Card className="p-0 shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 bg-emerald-600 text-white flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-sm font-mono">{picked.poNo}</h3>
            <span className="text-[12px] opacity-90">{picked.vendor ?? 'no vendor named'}</span>
            <span className="ml-auto text-[11px] opacity-90">
              {picked.lines.length} {picked.lines.length === 1 ? 'line' : 'lines'}
              {picked.poDate ? ` · ${formatDate(picked.poDate)}` : ''}
            </span>
          </div>

          <div className="p-4 space-y-3">
            {picked.alreadyImported && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] font-semibold text-amber-900">
                This PO is already in Warehouse V2. Importing again is refused — its balance is already
                on the Gate IN screen.
              </div>
            )}

            <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[12.5px] text-sky-900">
              These are IN4&apos;s lines, exactly as IN4 has them. Nothing is matched or renamed — the material
              name IN4 uses <b>is</b> the item. If what turns up at the gate is different, the storekeeper
              records what actually came and it is flagged for you and the bill.
            </div>

            {picked.newItems > 0 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12.5px] text-slate-700 flex items-start gap-2">
                <Sparkles className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-emerald-600" />
                <span>
                  <b>{picked.newItems}</b> of these {picked.newItems === 1 ? 'material is' : 'materials are'} new
                  to the warehouse and will be added as {picked.newItems === 1 ? 'an item' : 'items'} on import,
                  with IN4&apos;s name and unit.
                </span>
              </div>
            )}

            {picked.uomConflicts.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                <b className="flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" /> IN4 sent two units for the same material</b>
                <ul className="mt-1 space-y-0.5">
                  {picked.uomConflicts.map(c => (
                    <li key={c.name}>
                      {c.name} — kept <b>{c.kept}</b>, IN4 also sent <b>{c.alsoSeen}</b>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {picked.unnamed > 0 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
                {picked.unnamed} IN4 {picked.unnamed === 1 ? 'line has' : 'lines have'} no material name at all,
                so {picked.unnamed === 1 ? 'it' : 'they'} cannot become an item and will be skipped.
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-[12px]">
                <thead>
                  <tr className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 border-b border-slate-100">
                    <th className="text-left px-2 py-1.5">Material · as IN4 has it</th>
                    <th className="text-left px-2 py-1.5">Unit</th>
                    <th className="text-right px-2 py-1.5">Ordered</th>
                    <th className="text-right px-2 py-1.5">Received in IN4</th>
                    <th className="text-right px-2 py-1.5">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {picked.lines.map(l => (
                    <tr key={l.material} className="border-b border-slate-50 last:border-0">
                      <td className="px-2 py-1.5 text-slate-800">
                        {l.material}
                        {!l.itemExists && (
                          <span className="ml-1.5 text-[9.5px] font-extrabold uppercase rounded-full px-1.5 py-0.5 bg-emerald-100 text-emerald-700">
                            new
                          </span>
                        )}
                        {l.discipline && <span className="ml-1.5 text-[10.5px] text-slate-400">{l.discipline}</span>}
                      </td>
                      <td className="px-2 py-1.5 text-slate-600">
                        {l.uom ?? <span className="text-amber-700">not given</span>}
                        {l.ourUnit && (
                          <span className="block text-[10px] text-amber-700">we hold {l.ourUnit}</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-slate-900">{formatQty(l.orderedQty)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{formatQty(l.receivedQty)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">
                        {l.rate == null ? '—' : formatINR(l.rate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid sm:grid-cols-2 gap-2 pt-1 border-t border-slate-100">
              <div>
                <label className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1" htmlFor="po-entity">
                  Paid by
                </label>
                <select id="po-entity" className={inputCls} value={entity} onChange={e => setEntity(e.target.value)}>
                  <option value="">—</option>
                  {['SRMD Org Stock', 'SRASSK', 'SRET', 'SRJT', 'SRST'].map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1" htmlFor="po-project">
                  For project {picked.project && <span className="text-slate-400">· IN4 says {picked.project}</span>}
                </label>
                <select id="po-project" className={inputCls} value={projectId} onChange={e => setProjectId(e.target.value)}>
                  <option value="">—</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-[auto_1fr] gap-2">
              <button type="button" onClick={() => router.push(`/warehouse/po?q=${encodeURIComponent(search)}`)}
                className="rounded-lg border-2 border-slate-200 px-3 py-2.5 min-h-[44px] text-[12.5px] font-bold text-slate-600">
                Back
              </button>
              <button type="button" disabled={!canEdit || pending || picked.alreadyImported || picked.lines.length === 0}
                onClick={importPo}
                className="rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-2.5 min-h-[44px] text-sm font-bold text-white disabled:opacity-50 inline-flex items-center justify-center gap-2">
                {pending ? <Loader2 className="h-4 w-4 animate-spin" />
                  : picked.alreadyImported ? <Check className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                {pending ? 'Importing…'
                  : picked.alreadyImported ? 'Already imported'
                  : `Import all ${picked.lines.length} ${picked.lines.length === 1 ? 'line' : 'lines'}`}
              </button>
            </div>
            {!canEdit && (
              <p className="text-[11px] text-amber-800">
                You can look but not import. Ask an admin for edit access on Warehouse V2.
              </p>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}
