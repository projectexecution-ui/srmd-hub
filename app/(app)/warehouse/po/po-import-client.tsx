'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { savePo } from '../actions'
import type { TrackerPoSummary, TrackerPoLine } from '@/lib/warehouse/po-import'
import type { WhItem } from '@/lib/warehouse/types'
import { Search, Loader2, Check, HelpCircle } from 'lucide-react'

type Picked = {
  poNo: string; vendor: string | null; poDate: string | null; project: string | null
  indentNos: string[]; alreadyImported: boolean; lines: TrackerPoLine[]
}

const inputCls =
  'w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm bg-white ' +
  'focus:outline-none focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400'

export function PoImportClient({
  q, available, picked, items, projects, canEdit,
}: {
  q: string
  available: TrackerPoSummary[]
  picked: Picked | null
  items: WhItem[]
  projects: Array<{ id: string; name: string }>
  canEdit: boolean
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [pending, start] = useTransition()
  const [query, setQuery] = useState(q)

  // itemId per line, seeded from the remembered alias or the top suggestion
  const [chosen, setChosen] = useState<Record<string, string>>(() => seed(picked))
  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries((picked?.lines ?? []).map(l => [l.sourceText, l.orderedQty])))
  const [entity, setEntity] = useState('')
  const [projectId, setProjectId] = useState('')
  const [lastKey, setLastKey] = useState(picked?.poNo ?? '')

  // Re-seed when a different PO is opened (server component re-renders with new props)
  if (picked && picked.poNo !== lastKey) {
    setLastKey(picked.poNo)
    setChosen(seed(picked))
    setQty(Object.fromEntries(picked.lines.map(l => [l.sourceText, l.orderedQty])))
  }

  function go(next: Record<string, string | undefined>) {
    const sp = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(next)) v ? sp.set(k, v) : sp.delete(k)
    router.push(`/warehouse/po?${sp.toString()}`)
  }

  const confirmedCount = picked ? picked.lines.filter(l => chosen[l.sourceText]).length : 0
  const skippedCount = picked ? picked.lines.length - confirmedCount : 0

  function doImport() {
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
        lines: picked.lines
          .filter(l => chosen[l.sourceText])
          .map(l => ({
            itemId: chosen[l.sourceText],
            orderedQty: qty[l.sourceText] ?? l.orderedQty,
            rate: l.rate,
            sourceText: l.sourceText,
          })),
      })
      if (!res.ok) { toast.error(res.error); return }
      toast.success(
        `${res.poNo} imported — ${res.lines} line${res.lines === 1 ? '' : 's'}`
        + (res.learned > 0 ? `, ${res.learned} material name${res.learned === 1 ? '' : 's'} learned` : ''))
      go({ po: undefined })
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      <Card className="p-3 shadow-sm">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input className={inputCls + ' pl-8'} value={query} placeholder="PO number or vendor…"
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') go({ q: query || undefined, po: undefined }) }} />
          </div>
          <button type="button" onClick={() => go({ q: query || undefined, po: undefined })}
            className="rounded-lg bg-slate-800 px-4 text-sm font-bold text-white">Search</button>
        </div>

        <div className="mt-2 -mx-1 max-h-56 overflow-y-auto">
          {available.length === 0 && (
            <p className="px-1 py-3 text-sm text-slate-500">
              No POs in the tracker match that. Try part of the number, or a vendor name.
            </p>
          )}
          {available.map(p => (
            <button key={p.poNo} type="button" onClick={() => go({ po: p.poNo })}
              className={`w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-50 flex items-baseline gap-2 ${picked?.poNo === p.poNo ? 'bg-emerald-50' : ''}`}>
              <span className="font-mono text-[12px] font-bold text-slate-800">{p.poNo}</span>
              <span className="text-[12px] text-slate-600 truncate flex-1">{p.vendor ?? '—'}</span>
              <span className="text-[11px] text-slate-400">{p.poDate ?? ''}</span>
              <span className="text-[11px] text-slate-500 tabular-nums">{p.lineCount} line{p.lineCount === 1 ? '' : 's'}</span>
              {p.imported && <span className="text-[10px] font-extrabold uppercase text-emerald-700">imported</span>}
            </button>
          ))}
        </div>
      </Card>

      {picked && (
        <Card className="p-0 shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-800 text-white flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-bold">{picked.poNo}</span>
            <span className="text-[12px] opacity-90">{picked.vendor}</span>
            <span className="text-[11px] opacity-70">{picked.poDate}</span>
            <span className="ml-auto text-[11px] opacity-90">
              {confirmedCount} of {picked.lines.length} confirmed
            </span>
          </div>

          {picked.alreadyImported && (
            <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-[12px] font-semibold text-amber-900">
              This PO is already in Warehouse V2 — importing again is blocked.
            </div>
          )}

          <div className="p-3 grid sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1">Who paid</label>
              <select className={inputCls} value={entity} onChange={e => setEntity(e.target.value)}>
                <option value="">—</option>
                {['SRMD Org Stock', 'SRASSK', 'SRET', 'SRJT', 'SRST'].map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1">
                Project {picked.project && <span className="normal-case text-slate-400">· IN4 says &ldquo;{picked.project}&rdquo;</span>}
              </label>
              <select className={inputCls} value={projectId} onChange={e => setProjectId(e.target.value)}>
                <option value="">—</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="bg-slate-50 text-slate-500">
                  <th className="text-left font-bold px-3 py-2 border-y border-slate-200">IN4 material</th>
                  <th className="text-left font-bold px-3 py-2 border-y border-slate-200 min-w-[220px]">Which item is it?</th>
                  <th className="text-right font-bold px-3 py-2 border-y border-slate-200">Ordered</th>
                  <th className="text-right font-bold px-3 py-2 border-y border-slate-200">Rate ₹</th>
                </tr>
              </thead>
              <tbody>
                {picked.lines.map(l => {
                  const sel = chosen[l.sourceText] ?? ''
                  const top = l.suggestions[0]
                  const confident = !!l.aliasItemId || (top?.score ?? 0) >= 0.5
                  return (
                    <tr key={l.sourceText} className={`border-b border-slate-100 ${sel ? '' : 'bg-amber-50/40'}`}>
                      <td className="px-3 py-2 align-top">
                        <div className="font-semibold text-slate-800">{l.sourceText}</div>
                        <div className="text-[11px] text-slate-500">
                          {l.uom}{l.discipline ? ` · ${l.discipline}` : ''}
                          {l.receivedQty > 0 && <> · IN4 shows {fmt(l.receivedQty)} already received</>}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <select className={inputCls + (sel ? '' : ' border-amber-400')} value={sel}
                          onChange={e => setChosen(c => ({ ...c, [l.sourceText]: e.target.value }))}>
                          <option value="">Skip this line</option>
                          {l.suggestions.length > 0 && (
                            <optgroup label="Suggested">
                              {l.suggestions.map(s => (
                                <option key={s.itemId} value={s.itemId}>
                                  {s.name} · {Math.round(s.score * 100)}%
                                </option>
                              ))}
                            </optgroup>
                          )}
                          <optgroup label="All items">
                            {items.map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
                          </optgroup>
                        </select>
                        <div className="text-[11px] mt-1">
                          {l.aliasItemId ? (
                            <span className="text-emerald-700 font-bold inline-flex items-center gap-1">
                              <Check className="h-3 w-3" /> remembered from last time
                            </span>
                          ) : confident ? (
                            <span className="text-slate-500">Best guess pre-filled — change it if it&apos;s wrong.</span>
                          ) : l.suggestions.length > 0 ? (
                            <span className="text-amber-800 font-semibold inline-flex items-center gap-1">
                              <HelpCircle className="h-3 w-3" /> Not confident — pick it yourself
                            </span>
                          ) : (
                            <span className="text-slate-500">
                              Nothing similar in the master. Skip it, or pick an item.
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top text-right">
                        <input className={inputCls + ' font-mono text-right w-24'} inputMode="decimal"
                          value={qty[l.sourceText] ?? ''} onChange={e =>
                            setQty(s => ({ ...s, [l.sourceText]: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 }))} />
                      </td>
                      <td className="px-3 py-2 align-top text-right tabular-nums text-slate-600">
                        {l.rate ? fmt(l.rate) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="p-3 border-t border-slate-100 flex items-center gap-3 flex-wrap">
            <p className="text-[11.5px] text-slate-500 flex-1 min-w-[200px]">
              {skippedCount > 0
                ? <>{skippedCount} line{skippedCount === 1 ? '' : 's'} will be skipped — they simply won&apos;t appear on the PO balance. You can add them later.</>
                : <>Every line is matched. Confirming also teaches these material names for next time.</>}
            </p>
            <button type="button" disabled={!canEdit || pending || picked.alreadyImported || confirmedCount === 0}
              onClick={doImport}
              className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50 inline-flex items-center gap-2 hover:bg-emerald-700">
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              {pending ? 'Importing…' : `Import ${confirmedCount} line${confirmedCount === 1 ? '' : 's'}`}
            </button>
          </div>
        </Card>
      )}
    </div>
  )
}

/** Pre-fill: a remembered alias always wins; otherwise the top suggestion, but
 *  only when it is confident enough that accepting it is reasonable. */
function seed(picked: Picked | null): Record<string, string> {
  const out: Record<string, string> = {}
  for (const l of picked?.lines ?? []) {
    if (l.aliasItemId) { out[l.sourceText] = l.aliasItemId; continue }
    const top = l.suggestions[0]
    if (top && top.score >= 0.5) out[l.sourceText] = top.itemId
  }
  return out
}

function fmt(n: number): string {
  return Number(n.toFixed(2)).toLocaleString('en-IN')
}
