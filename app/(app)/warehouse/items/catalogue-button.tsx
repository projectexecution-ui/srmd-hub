'use client'

/** "Catalogue" on the Item Master — the same bound PDF and Excel register V1
 *  produced, built from V2's items and stock. */

import { useState, useTransition, useEffect } from 'react'
import { toast } from 'sonner'
import { loadCatalogue, catalogueStores } from '../catalogue-actions'
import { formatDateTime } from '@/lib/utils'
import { FileDown, FileSpreadsheet, Loader2, X } from 'lucide-react'

const inputCls =
  'w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm bg-white min-h-[40px] ' +
  'focus:outline-none focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400'

export function CatalogueButton() {
  const [open, setOpen] = useState(false)
  const [busy, start] = useTransition()
  const [stores, setStores] = useState<Array<{ id: string; name: string }>>([])
  const [scope, setScope] = useState('')
  const [photos, setPhotos] = useState(false)

  useEffect(() => {
    if (!open || stores.length) return
    let live = true
    catalogueStores().then(s => { if (live) setStores(s) })
    return () => { live = false }
  }, [open, stores.length])

  function run(kind: 'pdf' | 'xlsx') {
    start(async () => {
      const { rows, warehouses, scopeLabel, error } = await loadCatalogue(
        scope ? { locationId: scope } : {},
      )
      if (error) { toast.error(error, { duration: 9000 }); return }
      if (rows.length === 0) { toast.error('No active items to put in a catalogue.'); return }

      const meta = {
        orgLabel: 'SRMD Construction',
        generatedAtLabel: formatDateTime(new Date().toISOString()),
        scopeLabel,
        warehouses,
      }
      const stamp = new Date().toISOString().slice(0, 10)

      // Loaded on demand: jsPDF and xlsx are heavy, and most visits to the item
      // master never press this.
      const mod = await import('@/lib/inventory/catalogue-report')
      if (kind === 'pdf') {
        mod.buildCataloguePdf(rows, meta, {}, { photos }).save(`Material-Catalogue_${stamp}.pdf`)
      } else {
        const XLSX = await import('xlsx')
        XLSX.writeFile(mod.buildCatalogueExcel(rows, meta), `Material-Register_${stamp}.xlsx`)
      }
      toast.success(`${rows.length} items exported`)
      setOpen(false)
    })
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="rounded-lg border-2 border-slate-200 bg-white px-3 py-2 min-h-[40px] text-[12.5px] font-bold
                   text-slate-600 hover:border-emerald-300 hover:text-emerald-700 inline-flex items-center gap-1.5">
        <FileDown className="h-3.5 w-3.5" /> Catalogue
      </button>
    )
  }

  return (
    <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50/40 p-3 space-y-2 w-full sm:w-auto sm:min-w-[300px]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-800">Catalogue</p>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close"
          className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
      </div>

      <select className={inputCls} value={scope} onChange={e => setScope(e.target.value)}
        aria-label="Which store">
        <option value="">All stores</option>
        {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>

      <label className="flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-600 cursor-pointer">
        <input type="checkbox" checked={photos} onChange={e => setPhotos(e.target.checked)} className="h-3.5 w-3.5" />
        Include a picture column
      </label>
      <p className="text-[11px] text-slate-500">
        No warehouse item has a photo yet, so that column would show monograms until they are added.
      </p>

      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => run('pdf')}
          className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 min-h-[40px] text-[12.5px] font-bold text-white
                     hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />} PDF
        </button>
        <button type="button" disabled={busy} onClick={() => run('xlsx')}
          className="flex-1 rounded-lg border-2 border-slate-200 bg-white px-3 py-2 min-h-[40px] text-[12.5px]
                     font-bold text-slate-600 hover:border-emerald-300 disabled:opacity-50
                     inline-flex items-center justify-center gap-1.5">
          <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
        </button>
      </div>
    </div>
  )
}
