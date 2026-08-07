'use client'
import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { Button } from '@/components/ui/button'
import { FileDown, Sheet, Loader2, ImageIcon } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { istDateStr } from '@/lib/inventory/day-window'
import {
  buildCataloguePdf, buildCatalogueExcel,
  type CatalogueRow, type WarehouseInfo,
} from '@/lib/inventory/catalogue-report'

export type CatalogueClientRow = CatalogueRow

// Best-effort load of item photos into data URLs so they embed in the PDF.
// The item-images bucket is public; a tainted/failed image simply falls back
// to a monogram in the PDF, so we never block on it.
async function preloadImages(urls: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  await Promise.all(urls.map(url => new Promise<void>(resolve => {
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = img.naturalWidth
        c.height = img.naturalHeight
        const ctx = c.getContext('2d')
        if (ctx) {
          ctx.drawImage(img, 0, 0)
          out[url] = c.toDataURL('image/jpeg', 0.82)
        }
      } catch { /* tainted → monogram fallback */ }
      resolve()
    }
    img.onerror = () => resolve()
    img.src = url
  })))
  return out
}

export function CatalogueActions({ rows, warehouses }: {
  rows: CatalogueClientRow[]
  warehouses: WarehouseInfo[]
}) {
  const [busy, setBusy] = useState<null | 'pdf' | 'xlsx'>(null)
  const [category, setCategory] = useState('')       // '' = all
  const [store, setStore] = useState('')             // '' = all (warehouse code)
  const [lowOnly, setLowOnly] = useState(false)
  const [photos, setPhotos] = useState(false)

  const categories = useMemo(
    () => [...new Set(rows.map(r => (r.category?.trim() || 'Uncategorised')))].sort((a, b) => a.localeCompare(b)),
    [rows],
  )

  // Apply the filter bar. Choosing a store re-scopes each row's in-hand and
  // "where" to just that store (so the register reads as that store's register).
  const filtered = useMemo<CatalogueClientRow[]>(() => {
    let out = rows
    if (category) out = out.filter(r => (r.category?.trim() || 'Uncategorised') === category)
    if (store) {
      out = out
        .map(r => {
          const s = r.stores.find(x => x.code === store)
          if (!s || s.qty <= 0) return null
          // Re-scope to this store: its own qty, its own low flag.
          return { ...r, in_hand: s.qty, stores: [s], out: s.qty <= 0, low: s.low }
        })
        .filter((r): r is CatalogueClientRow => r !== null)
    }
    if (lowOnly) out = out.filter(r => r.low || r.out)
    return out
  }, [rows, category, store, lowOnly])

  const scopeLabel = useMemo(() => {
    const parts: string[] = []
    parts.push(store ? (warehouses.find(w => w.code === store)?.label ?? store) : 'All stores')
    if (category) parts.push(category)
    if (lowOnly) parts.push('low / out only')
    return parts.join(' · ')
  }, [store, category, lowOnly, warehouses])

  // When scoped to one store, the summary's per-store tiles show just that store.
  const meta = () => ({
    orgLabel: 'SRMD Construction',
    generatedAtLabel: formatDateTime(new Date()),
    scopeLabel,
    warehouses: store ? warehouses.filter(w => w.code === store) : warehouses,
  })
  const stamp = () => istDateStr()

  async function pdf() {
    setBusy('pdf')
    try {
      let images: Record<string, string> = {}
      if (photos) {
        const urls = [...new Set(filtered.map(r => r.image_url).filter((u): u is string => !!u))]
        images = urls.length ? await preloadImages(urls) : {}
      }
      const doc = buildCataloguePdf(filtered, meta(), images, { photos })
      doc.save(`Material-Catalogue_${stamp()}.pdf`)
    } finally {
      setBusy(null)
    }
  }

  function xlsx() {
    setBusy('xlsx')
    try {
      const wb = buildCatalogueExcel(filtered, meta())
      XLSX.writeFile(wb, `Material-Catalogue_${stamp()}.xlsx`)
    } finally {
      setBusy(null)
    }
  }

  const empty = filtered.length === 0
  const disabled = busy !== null || empty
  const selCls = 'h-9 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500/40'

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-100 bg-gray-50/70 p-3">
        <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
          Category
          <select value={category} onChange={e => setCategory(e.target.value)} className={selCls} aria-label="Filter by category">
            <option value="">All</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
          Store
          <select value={store} onChange={e => setStore(e.target.value)} className={selCls} aria-label="Filter by store">
            <option value="">All stores</option>
            {warehouses.map(w => <option key={w.code} value={w.code}>{w.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer select-none">
          <input type="checkbox" checked={lowOnly} onChange={e => setLowOnly(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
          Low / out only
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer select-none">
          <input type="checkbox" checked={photos} onChange={e => setPhotos(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
          <ImageIcon className="h-3.5 w-3.5 text-gray-400" /> Include photos
        </label>
        <span className="ml-auto text-xs text-gray-500 tabular-nums">
          {filtered.length.toLocaleString('en-IN')} of {rows.length.toLocaleString('en-IN')} items
        </span>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button onClick={pdf} disabled={disabled}>
          {busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
          Download PDF
        </Button>
        <Button variant="outline" onClick={xlsx} disabled={disabled}>
          {busy === 'xlsx' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sheet className="h-4 w-4" />}
          Download Excel
        </Button>
        {empty && <span className="text-xs text-gray-400 self-center">No items match these filters.</span>}
        {photos && !empty && <span className="text-xs text-gray-400 self-center">Photos make a larger file &amp; take a moment to load.</span>}
      </div>
    </div>
  )
}
