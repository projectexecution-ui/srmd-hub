'use client'
// Renders the original uploaded Excel in the browser so an approver can
// scrub through measurements + per-cell formulas without downloading —
// in the file's OWN format: fill colours, merged cells, column widths,
// row heights, hidden rows/columns and Excel's own number formatting.
// The uploaded file itself is never modified; Download always returns
// the exact original.
//
// Parsing is SheetJS with cellStyles (fast: ~1s / ~80MB on the largest
// real budget workbook). ExcelJS was evaluated and rejected — it ran out
// of memory (>4GB) loading the same 450KB file. SheetJS CE reads fills,
// merges, widths and heights; fonts/borders are not exposed by the
// community edition, which is an accepted fidelity limit.
//
// Lazy-loaded: the library is a dynamic import fetched only when the
// user opens the card (keeps it out of the route bundle).

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { FileSpreadsheet, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'

const MAX_RENDER_ROWS = 1500
const MAX_RENDER_COLS = 60

interface CellModel {
  text: string
  formula: string | null
  bg?: string
  rowSpan?: number
  colSpan?: number
  /** Covered by a merge anchor — don't render a td. */
  skip?: boolean
}
interface RenderRow {
  /** Original 0-based Excel row index (hidden rows are filtered out). */
  idx: number
  heightPx?: number
  cells: CellModel[]
}
interface SheetModel {
  name: string
  /** Original 0-based column indexes that are visible, in order. */
  colIdx: number[]
  colWidths: number[] // px, aligned with colIdx
  rows: RenderRow[]
  truncatedRows: number
}

function colLetter(idx: number): string {
  let s = ''
  let n = idx + 1
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

async function parseWorkbook(buf: ArrayBuffer): Promise<SheetModel[]> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(buf, { type: 'array', cellFormula: true, cellNF: true, cellText: true, cellStyles: true })

  const models: SheetModel[] = []
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (!ws || !ws['!ref']) {
      models.push({ name, colIdx: [], colWidths: [], rows: [], truncatedRows: 0 })
      continue
    }
    const range = XLSX.utils.decode_range(ws['!ref'])
    const colEnd = Math.min(range.e.c, MAX_RENDER_COLS - 1)

    // Column metadata: pixel widths + hidden flags (render like Excel does).
    /* eslint-disable @typescript-eslint/no-explicit-any -- SheetJS style
       metadata (!cols/!rows/cell.s) has no public types. */
    const colsMeta = (ws['!cols'] ?? []) as any[]
    const colIdx: number[] = []
    const colWidths: number[] = []
    for (let c = range.s.c; c <= colEnd; c++) {
      const meta = colsMeta[c]
      if (meta?.hidden) continue
      colIdx.push(c)
      colWidths.push(meta?.wpx ? Math.max(28, Math.round(meta.wpx)) : 80)
    }

    // Merged ranges → anchor spans + covered-cell skip set. Spans count
    // only VISIBLE rows/columns so hidden ones don't stretch the table.
    const rowsMeta = (ws['!rows'] ?? []) as any[]
    const rowHidden = (r: number) => !!rowsMeta[r]?.hidden
    const colVisible = new Set(colIdx)
    const anchor = new Map<string, { rowSpan: number; colSpan: number }>()
    const covered = new Set<string>()
    for (const m of (ws['!merges'] ?? [])) {
      let rowSpan = 0
      for (let r = m.s.r; r <= m.e.r; r++) if (!rowHidden(r)) rowSpan++
      let colSpan = 0
      for (let c = m.s.c; c <= m.e.c; c++) if (colVisible.has(c)) colSpan++
      anchor.set(`${m.s.r}:${m.s.c}`, { rowSpan: Math.max(rowSpan, 1), colSpan: Math.max(colSpan, 1) })
      for (let r = m.s.r; r <= m.e.r; r++) {
        for (let c = m.s.c; c <= m.e.c; c++) {
          if (r !== m.s.r || c !== m.s.c) covered.add(`${r}:${c}`)
        }
      }
    }

    const rows: RenderRow[] = []
    let rendered = 0
    let r = range.s.r
    for (; r <= range.e.r && rendered < MAX_RENDER_ROWS; r++) {
      if (rowHidden(r)) continue
      rendered++
      const cells: CellModel[] = []
      for (const c of colIdx) {
        const key = `${r}:${c}`
        if (covered.has(key)) { cells.push({ text: '', formula: null, skip: true }); continue }
        const cell = ws[XLSX.utils.encode_cell({ r, c })] as any
        let text = ''
        if (cell?.w != null) text = String(cell.w) // Excel's own formatted text
        else if (typeof cell?.v === 'number') text = cell.v.toLocaleString('en-IN', { maximumFractionDigits: 6 })
        else if (cell?.v != null) text = String(cell.v)
        // Fill colour: solid pattern with a resolved rgb (theme+tint are
        // pre-resolved by SheetJS into .rgb).
        let bg: string | undefined
        const s = cell?.s
        if (s?.patternType === 'solid' && typeof s.fgColor?.rgb === 'string') {
          const rgb = s.fgColor.rgb.slice(-6).toLowerCase()
          if (/^[0-9a-f]{6}$/.test(rgb) && rgb !== 'ffffff') bg = `#${rgb}`
        }
        const span = anchor.get(key)
        cells.push({
          text,
          formula: cell?.f ?? null,
          bg,
          rowSpan: span?.rowSpan,
          colSpan: span?.colSpan,
        })
      }
      rows.push({ idx: r, heightPx: rowsMeta[r]?.hpx ? Math.round(rowsMeta[r].hpx) : undefined, cells })
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */

    models.push({ name, colIdx, colWidths, rows, truncatedRows: Math.max(range.e.r - r + 1, 0) })
  }
  return models
}

export function SourceExcelViewer({ url, name, microsoft = false }: {
  url: string | null
  name: string | null
  /** Render through Microsoft Office Online instead of the in-app table.
   *  Pixel-perfect, but the file is sent to Microsoft's servers. */
  microsoft?: boolean
}) {
  const [sheets, setSheets] = useState<SheetModel[] | null>(null)
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [showFormulas, setShowFormulas] = useState(true)

  // Microsoft mode works on .xlsx only (it can't reach a private file with
  // no public URL, and won't render .xls reliably). We hand it the signed
  // URL, which is publicly fetchable for its TTL.
  const canUseMicrosoft = microsoft && !!url && !(name ?? '').toLowerCase().endsWith('.xls')

  async function load() {
    if (canUseMicrosoft) { setOpen(true); return } // no local parse needed
    if (sheets) { setOpen(true); return }
    if (!url) { setErr('No source file attached'); return }
    setLoading(true); setErr(null)
    try {
      const r = await fetch(url)
      if (!r.ok) throw new Error(`Could not fetch (${r.status})`)
      const buf = await r.arrayBuffer()
      const models = await parseWorkbook(buf)
      setSheets(models)
      setActive(0)
      setOpen(true)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to open')
    } finally {
      setLoading(false)
    }
  }

  function renderSheet(m: SheetModel | undefined) {
    if (!m) return null
    if (m.rows.length === 0) {
      return <p className="text-sm text-gray-500 italic p-4">Empty sheet.</p>
    }
    return (
      <div className="overflow-auto max-h-[70vh] border border-gray-200 rounded-lg">
        <table className="text-xs border-collapse" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 44 }} />
            {m.colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
          </colgroup>
          <thead className="bg-gray-100 sticky top-0 z-10">
            <tr>
              <th className="border border-gray-200 px-2 py-1 w-10 text-gray-400 font-normal">#</th>
              {m.colIdx.map(c => (
                <th key={c} className="border border-gray-200 px-2 py-1 text-gray-500 font-medium text-left">{colLetter(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.rows.map(row => (
              <tr key={row.idx} style={row.heightPx ? { height: row.heightPx } : undefined}>
                <td className="border border-gray-200 px-2 py-1 text-gray-400 bg-gray-50 sticky left-0 text-right">{row.idx + 1}</td>
                {row.cells.map((cell, i) => {
                  if (cell.skip) return null
                  const hasFormula = !!cell.formula
                  return (
                    <td
                      key={i}
                      rowSpan={cell.rowSpan}
                      colSpan={cell.colSpan}
                      className={`border border-gray-200 px-2 py-1 align-top whitespace-nowrap overflow-hidden text-ellipsis ${hasFormula && !cell.bg ? 'bg-blue-50/40' : ''}`}
                      style={cell.bg ? { backgroundColor: cell.bg } : undefined}
                      title={hasFormula ? `=${cell.formula}` : (cell.text.length > 40 ? cell.text : undefined)}
                    >
                      <span className="text-gray-800">{cell.text || (hasFormula ? ' ' : '')}</span>
                      {showFormulas && hasFormula && (
                        <span className="block text-[10px] text-blue-600 font-mono leading-tight">={cell.formula}</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {m.truncatedRows > 0 && (
          <p className="px-3 py-2 text-[11px] text-amber-800 bg-amber-50 border-t border-amber-200">
            Showing the first {MAX_RENDER_ROWS.toLocaleString('en-IN')} rows — download the file for the remaining {m.truncatedRows.toLocaleString('en-IN')}.
          </p>
        )}
      </div>
    )
  }

  const activeSheet = sheets?.[active]

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base inline-flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-green-700" />
            Source Excel — full working
          </CardTitle>
          <Button size="sm" variant="outline" onClick={() => (open ? setOpen(false) : load())} disabled={loading || !url}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {open ? 'Hide' : ((sheets || canUseMicrosoft) ? 'Show' : 'Open viewer')}
          </Button>
        </div>
      </CardHeader>
      {open && canUseMicrosoft && (
        <CardContent className="space-y-2">
          <p className="text-xs text-gray-500">
            Showing <b>{name ?? 'the uploaded file'}</b> via Microsoft Office Online — pixel-perfect.
            The file is sent to Microsoft&apos;s servers to display it. Download gives the exact original.
          </p>
          <iframe
            title="Excel preview (Microsoft Office Online)"
            src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url!)}`}
            className="w-full h-[70vh] rounded-lg border border-gray-200"
          />
        </CardContent>
      )}
      {open && !canUseMicrosoft && (
        <CardContent className="space-y-3">
          {err && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</p>}
          {!err && (
            <>
              <p className="text-xs text-gray-500">
                Showing <b>{name ?? 'the uploaded file'}</b> in its own format — colours, merged
                cells, column widths and Excel&apos;s number formatting as uploaded. The file is never
                changed; Download gives the exact original.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {sheets?.map((s, i) => (
                  <button
                    key={s.name + i}
                    onClick={() => setActive(i)}
                    className={`px-3 py-1 text-xs rounded-full border transition-colors ${active === i ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                  >
                    {s.name}
                  </button>
                ))}
                <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-gray-600">
                  <input type="checkbox" checked={showFormulas} onChange={e => setShowFormulas(e.target.checked)} />
                  Show formulas
                </label>
              </div>
              {renderSheet(activeSheet)}
            </>
          )}
        </CardContent>
      )}
    </Card>
  )
}
