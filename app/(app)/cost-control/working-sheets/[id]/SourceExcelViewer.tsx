'use client'
// Renders the original uploaded .xlsx in the browser so an approver can
// scrub through measurements + per-cell formulas without downloading.
// Lazy-loaded: fetches + parses only when the user opens the card.

import { useState } from 'react'
import * as XLSX from 'xlsx'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { FileSpreadsheet, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'

interface CellLike { v?: unknown; f?: string; w?: string }

// Stringify a cell value taking the formatted text (w) when present,
// otherwise the raw value (v). Numbers fall back to toLocaleString so
// they render with grouping just like Excel does.
function cellText(c: CellLike | undefined): string {
  if (!c) return ''
  if (c.w != null) return String(c.w)
  if (c.v == null) return ''
  if (typeof c.v === 'number') return c.v.toLocaleString('en-IN', { maximumFractionDigits: 6 })
  return String(c.v)
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

export function SourceExcelViewer({ url, name }: { url: string | null; name: string | null }) {
  const [wb, setWb] = useState<XLSX.WorkBook | null>(null)
  const [active, setActive] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [showFormulas, setShowFormulas] = useState(true)

  async function load() {
    if (wb) { setOpen(true); return }
    if (!url) { setErr('No source file attached'); return }
    setLoading(true); setErr(null)
    try {
      const r = await fetch(url)
      if (!r.ok) throw new Error(`Could not fetch (${r.status})`)
      const buf = await r.arrayBuffer()
      const parsed = XLSX.read(buf, { type: 'array', cellFormula: true, cellNF: true, cellText: true })
      setWb(parsed)
      setActive(parsed.SheetNames[0] ?? '')
      setOpen(true)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to open')
    } finally {
      setLoading(false)
    }
  }

  function renderSheet(sheetName: string) {
    if (!wb) return null
    const sheet = wb.Sheets[sheetName]
    if (!sheet || !sheet['!ref']) {
      return <p className="text-sm text-gray-500 italic p-4">Empty sheet.</p>
    }
    const range = XLSX.utils.decode_range(sheet['!ref'])
    const cols: number[] = []
    for (let c = range.s.c; c <= range.e.c; c++) cols.push(c)
    const rows: number[] = []
    for (let r = range.s.r; r <= range.e.r; r++) rows.push(r)

    return (
      <div className="overflow-auto max-h-[70vh] border border-gray-200 rounded-lg">
        <table className="text-xs border-collapse">
          <thead className="bg-gray-100 sticky top-0 z-10">
            <tr>
              <th className="border border-gray-200 px-2 py-1 w-10 text-gray-400 font-normal">#</th>
              {cols.map(c => (
                <th key={c} className="border border-gray-200 px-2 py-1 text-gray-500 font-medium text-left min-w-[80px]">{colLetter(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r}>
                <td className="border border-gray-200 px-2 py-1 text-gray-400 bg-gray-50 sticky left-0 text-right">{r + 1}</td>
                {cols.map(c => {
                  const addr = XLSX.utils.encode_cell({ r, c })
                  const cell = sheet[addr] as CellLike | undefined
                  const text = cellText(cell)
                  const hasFormula = !!cell?.f
                  return (
                    <td
                      key={c}
                      className={`border border-gray-200 px-2 py-1 align-top whitespace-nowrap ${hasFormula ? 'bg-blue-50/40' : ''}`}
                      title={hasFormula ? `=${cell?.f}` : undefined}
                    >
                      <span className="text-gray-800">{text || (hasFormula ? ' ' : '')}</span>
                      {showFormulas && hasFormula && (
                        <span className="block text-[10px] text-blue-600 font-mono leading-tight">={cell!.f}</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

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
            {open ? 'Hide' : (wb ? 'Show' : 'Open viewer')}
          </Button>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          {err && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</p>}
          {!err && (
            <>
              <p className="text-xs text-gray-500">
                Showing <b>{name ?? 'the uploaded file'}</b> exactly as you uploaded it.
                Formula cells are tinted blue with the formula shown under the value.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {wb?.SheetNames.map(n => (
                  <button
                    key={n}
                    onClick={() => setActive(n)}
                    className={`px-3 py-1 text-xs rounded-full border transition-colors ${active === n ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                  >
                    {n}
                  </button>
                ))}
                <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-gray-600">
                  <input type="checkbox" checked={showFormulas} onChange={e => setShowFormulas(e.target.checked)} />
                  Show formulas
                </label>
              </div>
              {renderSheet(active)}
            </>
          )}
        </CardContent>
      )}
    </Card>
  )
}
