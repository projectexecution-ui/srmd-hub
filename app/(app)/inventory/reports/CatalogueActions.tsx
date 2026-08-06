'use client'
import { useState } from 'react'
import * as XLSX from 'xlsx'
import { Button } from '@/components/ui/button'
import { FileDown, Sheet, Loader2 } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { istDateStr } from '@/lib/inventory/day-window'
import {
  buildCataloguePdf, buildCatalogueExcel, type CatalogueRow,
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

export function CatalogueActions({ rows }: { rows: CatalogueClientRow[]; generatedAtLabel?: string }) {
  const [busy, setBusy] = useState<null | 'pdf' | 'xlsx'>(null)

  const meta = () => ({ orgLabel: 'SRMD Construction', generatedAtLabel: formatDateTime(new Date()), scopeLabel: 'All stores' })
  const stamp = () => istDateStr()

  async function pdf() {
    setBusy('pdf')
    try {
      const urls = [...new Set(rows.map(r => r.image_url).filter((u): u is string => !!u))]
      const images = urls.length ? await preloadImages(urls) : {}
      const doc = buildCataloguePdf(rows, meta(), images)
      doc.save(`Material-Catalogue_${stamp()}.pdf`)
    } finally {
      setBusy(null)
    }
  }

  function xlsx() {
    setBusy('xlsx')
    try {
      const wb = buildCatalogueExcel(rows, meta())
      XLSX.writeFile(wb, `Material-Catalogue_${stamp()}.xlsx`)
    } finally {
      setBusy(null)
    }
  }

  const disabled = busy !== null || rows.length === 0

  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={pdf} disabled={disabled}>
        {busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
        Download PDF
      </Button>
      <Button variant="outline" onClick={xlsx} disabled={disabled}>
        {busy === 'xlsx' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sheet className="h-4 w-4" />}
        Download Excel
      </Button>
      {rows.length === 0 && <span className="text-xs text-gray-400 self-center">No active items to export.</span>}
    </div>
  )
}
