'use client'
import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, Upload, AlertTriangle, Check, X, FileSpreadsheet, Download } from 'lucide-react'
import { formatINR } from '@/lib/jmr/format'

interface Project { id: string; code: string | null; name: string; parent_project_id: string | null }
interface Contractor { id: string; name: string }
interface Item { id: string; name: string; category: string; unit: string }
interface RateCard {
  id: string; contractor_id: string; item_id: string; project_id: string | null
  rate_per_unit: number | string; valid_from: string; valid_till: string | null
}

type ParsedRow = {
  rowNo: number
  // Resolved values for insert
  project_id: string | null
  sub_project_id: string | null
  contractor_id: string | null
  item_id: string | null
  unit: string
  entry_date: string
  start_meter: number | null
  end_meter: number | null
  quantity: number | null
  rate: number | null
  amount: number | null
  work_description: string | null
  // Raw + diagnostics
  raw: Record<string, unknown>
  errors: string[]
}

interface Props {
  projects: Project[]
  contractors: Contractor[]
  items: Item[]
  rateCards: RateCard[]
}

const HEADER_ALIASES: Record<string, string[]> = {
  date:             ['date', 'entry_date', 'entrydate'],
  project:          ['project', 'project_code', 'project code', 'project name'],
  sub_project:      ['sub_project', 'sub project', 'subproject'],
  contractor:       ['contractor', 'contractor_name'],
  item:             ['item', 'item_name', 'machine', 'equipment', 'manpower'],
  start_time:       ['start_time', 'start time', 'starttime', 'start meter', 'start_meter'],
  end_time:         ['end_time', 'end time', 'endtime', 'end meter', 'end_meter'],
  quantity:         ['quantity', 'qty', 'hours', 'hour', 'hr'],
  rate:             ['rate', 'rate_per_unit', 'rate per unit'],
  work_description: ['work_description', 'work', 'description', 'remarks', 'note', 'notes'],
}

function pickHeader(headers: string[], canonical: string): string | null {
  const aliases = HEADER_ALIASES[canonical] ?? [canonical]
  for (const a of aliases) {
    const found = headers.find(h => h.trim().toLowerCase() === a.toLowerCase())
    if (found) return found
  }
  return null
}

// Excel may give a date as a number (serial) or a string.
function parseDate(v: unknown): string | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') {
    // Excel date serial → JS Date
    const d = XLSX.SSF.parse_date_code(v)
    if (!d) return null
    const m = String(d.m).padStart(2, '0')
    const day = String(d.d).padStart(2, '0')
    return `${d.y}-${m}-${day}`
  }
  const s = String(v).trim()
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  // dd/mm/yyyy or dd-mm-yyyy
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/)
  if (m) {
    let [, d, mo, y] = m
    if (y.length === 2) y = '20' + y
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  // JS parse fallback
  const t = new Date(s)
  if (!isNaN(t.getTime())) {
    const y = t.getFullYear()
    const mo = String(t.getMonth() + 1).padStart(2, '0')
    const day = String(t.getDate()).padStart(2, '0')
    return `${y}-${mo}-${day}`
  }
  return null
}

function parseTimeToHours(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') {
    // Excel time fraction (0.5 = 12:00)
    if (v >= 0 && v < 2) return +(v * 24).toFixed(4)
    return v // treat as already-decimal-hours
  }
  const s = String(v).trim()
  const m = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i)
  if (m) {
    let hh = Number(m[1]); const mm = Number(m[2]); const ampm = m[3]?.toLowerCase()
    if (ampm === 'pm' && hh < 12) hh += 12
    if (ampm === 'am' && hh === 12) hh = 0
    return +(hh + mm / 60).toFixed(4)
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function findByName<T extends { name: string }>(list: T[], q: string): T | null {
  const lc = q.trim().toLowerCase()
  return list.find(x => x.name.trim().toLowerCase() === lc) ?? null
}
function findProject(list: Project[], q: string): Project | null {
  const lc = q.trim().toLowerCase()
  // Try code first, then name
  return (
    list.find(p => p.code?.trim().toLowerCase() === lc) ??
    list.find(p => p.name.trim().toLowerCase() === lc) ??
    null
  )
}

function resolveRate(args: {
  cards: RateCard[]
  contractor_id: string
  item_id: string
  project_id: string | null
  on_date: string
}): number | null {
  const inWindow = args.cards.filter(c =>
    c.contractor_id === args.contractor_id &&
    c.item_id === args.item_id &&
    c.valid_from <= args.on_date &&
    (c.valid_till == null || c.valid_till >= args.on_date),
  )
  const projectMatch = inWindow.find(c => c.project_id === args.project_id)
  if (projectMatch) return Number(projectMatch.rate_per_unit)
  const fallback = inWindow.find(c => c.project_id === null)
  return fallback ? Number(fallback.rate_per_unit) : null
}

export function JmrImportClient({ projects, contractors, items, rateCards }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [fileName, setFileName] = useState<string | null>(null)
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ inserted: number; failed: number } | null>(null)

  // Top-level projects (not sub-projects) for the project name lookup.
  const topProjects = useMemo(() => projects.filter(p => p.parent_project_id == null), [projects])
  // Sub-projects keyed by parent for sub_project resolution.
  const subProjectsByParent = useMemo(() => {
    const m = new Map<string, Project[]>()
    for (const p of projects) {
      if (p.parent_project_id) {
        const arr = m.get(p.parent_project_id) ?? []
        arr.push(p)
        m.set(p.parent_project_id, arr)
      }
    }
    return m
  }, [projects])

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setError(null); setResult(null); setRows([]); setFileName(f.name)
    try {
      const buf = await f.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: false })
      const ws = wb.Sheets[wb.SheetNames[0]]
      if (!ws) { setError('Workbook has no sheets'); return }
      const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: null })
      if (raw.length === 0) { setError('First sheet is empty'); return }
      const headers = Object.keys(raw[0])

      const colDate         = pickHeader(headers, 'date')
      const colProject      = pickHeader(headers, 'project')
      const colSubProject   = pickHeader(headers, 'sub_project')
      const colContractor   = pickHeader(headers, 'contractor')
      const colItem         = pickHeader(headers, 'item')
      const colStartTime    = pickHeader(headers, 'start_time')
      const colEndTime      = pickHeader(headers, 'end_time')
      const colQty          = pickHeader(headers, 'quantity')
      const colRate         = pickHeader(headers, 'rate')
      const colDesc         = pickHeader(headers, 'work_description')

      const missing: string[] = []
      if (!colDate)        missing.push('date')
      if (!colProject)     missing.push('project')
      if (!colContractor)  missing.push('contractor')
      if (!colItem)        missing.push('item')
      if (!colQty && !(colStartTime && colEndTime)) missing.push('quantity OR (start_time + end_time)')
      if (missing.length > 0) {
        setError(`Missing required column(s): ${missing.join(', ')}`); return
      }

      const parsed: ParsedRow[] = raw.map((r, i) => {
        const errs: string[] = []
        const dateRaw = colDate ? r[colDate] : null
        const entry_date = parseDate(dateRaw)
        if (!entry_date) errs.push(`bad date: "${dateRaw ?? ''}"`)

        const projectRaw = colProject ? String(r[colProject] ?? '').trim() : ''
        const project = projectRaw ? findProject(topProjects, projectRaw) : null
        if (projectRaw && !project) errs.push(`unknown project: "${projectRaw}"`)

        let sub_project_id: string | null = null
        const subRaw = colSubProject ? String(r[colSubProject] ?? '').trim() : ''
        if (subRaw && project) {
          const subs = subProjectsByParent.get(project.id) ?? []
          const sub = subs.find(s => s.code?.trim().toLowerCase() === subRaw.toLowerCase()
                                  || s.name.trim().toLowerCase() === subRaw.toLowerCase())
          if (!sub) errs.push(`unknown sub-project: "${subRaw}"`)
          else sub_project_id = sub.id
        }

        const contractorRaw = colContractor ? String(r[colContractor] ?? '').trim() : ''
        const contractor = contractorRaw ? findByName(contractors, contractorRaw) : null
        if (contractorRaw && !contractor) errs.push(`unknown contractor: "${contractorRaw}"`)

        const itemRaw = colItem ? String(r[colItem] ?? '').trim() : ''
        const item = itemRaw ? findByName(items, itemRaw) : null
        if (itemRaw && !item) errs.push(`unknown item: "${itemRaw}"`)

        // Quantity / hours resolution
        let quantity: number | null = null
        let start_meter: number | null = null
        let end_meter: number | null = null
        const sH = colStartTime ? parseTimeToHours(r[colStartTime]) : null
        const eH = colEndTime ? parseTimeToHours(r[colEndTime]) : null
        if (sH != null && eH != null) {
          start_meter = sH
          end_meter = eH
          const raw = eH >= sH ? eH - sH : (24 - sH) + eH
          quantity = +raw.toFixed(2)
          if (quantity <= 0 || quantity > 24) {
            errs.push(`bad time range: ${sH} → ${eH}`)
            quantity = null
          }
        } else if (colQty) {
          const v = Number(r[colQty])
          quantity = Number.isFinite(v) ? v : null
          if (quantity != null && quantity <= 0) {
            errs.push(`quantity must be > 0`)
            quantity = null
          }
        }
        if (quantity == null) errs.push('missing quantity or start/end time')

        // Rate
        let rate: number | null = null
        if (colRate && r[colRate] != null && r[colRate] !== '') {
          const v = Number(r[colRate])
          if (Number.isFinite(v) && v > 0) rate = v
        }
        if (rate == null && contractor && item && entry_date) {
          rate = resolveRate({
            cards: rateCards,
            contractor_id: contractor.id,
            item_id: item.id,
            project_id: project?.id ?? null,
            on_date: entry_date,
          })
        }
        if (rate == null) errs.push('no rate card matches contractor + item + date')

        const amount = (rate != null && quantity != null) ? +(rate * quantity).toFixed(2) : null

        return {
          rowNo: i + 2, // +1 header, +1 1-indexed
          project_id: project?.id ?? null,
          sub_project_id,
          contractor_id: contractor?.id ?? null,
          item_id: item?.id ?? null,
          unit: item?.unit ?? '',
          entry_date: entry_date ?? '',
          start_meter,
          end_meter,
          quantity,
          rate,
          amount,
          work_description: colDesc ? (String(r[colDesc] ?? '').trim() || null) : null,
          raw: r,
          errors: errs,
        }
      })

      setRows(parsed)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse file')
    }
  }

  const okRows = rows.filter(r => r.errors.length === 0)
  const errRows = rows.filter(r => r.errors.length > 0)

  async function commit() {
    if (okRows.length === 0) return
    setBusy(true); setError(null); setResult(null)
    const { data: { user } } = await supabase.auth.getUser()
    const inserts = okRows.map(r => ({
      project_id: r.project_id,
      sub_project_id: r.sub_project_id,
      contractor_id: r.contractor_id,
      item_id: r.item_id,
      entry_date: r.entry_date,
      start_meter: r.start_meter,
      end_meter: r.end_meter,
      quantity: r.quantity,
      rate_snapshot: r.rate,
      amount: r.amount,
      work_description: r.work_description,
      logged_by_user_id: user?.id ?? null,
      status: 'submitted',
    }))
    // Chunked insert to keep payloads reasonable.
    const CHUNK = 200
    let inserted = 0; let failed = 0
    for (let i = 0; i < inserts.length; i += CHUNK) {
      const batch = inserts.slice(i, i + CHUNK)
      const { error } = await supabase.from('jmr_daily_entries').insert(batch)
      if (error) {
        // Try one-by-one to count exactly how many fail vs succeed.
        for (const row of batch) {
          const { error: e2 } = await supabase.from('jmr_daily_entries').insert(row)
          if (e2) failed++; else inserted++
        }
      } else {
        inserted += batch.length
      }
    }
    setBusy(false)
    setResult({ inserted, failed })
    if (inserted > 0) router.refresh()
  }

  function reset() {
    setFileName(null); setRows([]); setResult(null); setError(null)
  }

  // Generate a starter .xlsx using one of the user's existing projects /
  // contractors / items so the template is immediately runnable.
  function downloadTemplate() {
    const sampleProject = topProjects[0]
    const sampleContractor = contractors[0]
    const sampleItem = items[0]
    const today = new Date().toISOString().slice(0, 10)
    const sample = {
      date: today,
      project: sampleProject?.code ?? sampleProject?.name ?? 'PROJECT_CODE',
      sub_project: '',
      contractor: sampleContractor?.name ?? 'CONTRACTOR_NAME',
      item: sampleItem?.name ?? 'ITEM_NAME',
      start_time: sampleItem?.unit === 'hr' ? '08:00' : '',
      end_time:   sampleItem?.unit === 'hr' ? '17:00' : '',
      quantity:   sampleItem?.unit === 'hr' ? '' : 1,
      rate: '',
      work_description: 'Foundation pit, gridline 5-7',
    }
    const ws = XLSX.utils.json_to_sheet([sample], {
      header: ['date','project','sub_project','contractor','item','start_time','end_time','quantity','rate','work_description'],
    })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'jmr_entries')
    XLSX.writeFile(wb, 'jmr-import-template.xlsx')
  }

  return (
    <div className="space-y-4">
      {!fileName ? (
        <Card className="p-6 border-dashed border-2 border-gray-300 bg-gray-50 text-center">
          <FileSpreadsheet className="h-8 w-8 mx-auto text-gray-400 mb-2" />
          <p className="text-sm text-gray-700 mb-3">Drop an Excel file with the JMR entries</p>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <label className="inline-flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg px-4 h-10 cursor-pointer">
              <Upload className="h-4 w-4" /> Choose .xlsx
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />
            </label>
            <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="h-4 w-4" /> Download template
            </Button>
          </div>
          <p className="text-[11px] text-gray-500 mt-3">
            Need a starting point? Download the template — it includes one sample row
            using your existing projects, contractors and items.
          </p>
        </Card>
      ) : (
        <Card className="p-3 flex items-center justify-between gap-2 text-sm">
          <span className="inline-flex items-center gap-2 text-gray-800 truncate">
            <FileSpreadsheet className="h-4 w-4 text-gray-500 flex-shrink-0" />
            <span className="truncate">{fileName}</span>
            <span className="text-xs text-gray-500 flex-shrink-0">· {rows.length} row{rows.length === 1 ? '' : 's'}</span>
          </span>
          <Button variant="ghost" size="sm" onClick={reset}><X className="h-4 w-4" /></Button>
        </Card>
      )}

      {error && (
        <Card className="p-3 bg-rose-50 border-rose-200 text-sm text-rose-900 inline-flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" /> {error}
        </Card>
      )}

      {rows.length > 0 && !result && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-1 text-emerald-700"><Check className="h-4 w-4" /> {okRows.length} ready</span>
            {errRows.length > 0 && (
              <span className="inline-flex items-center gap-1 text-rose-700"><AlertTriangle className="h-4 w-4" /> {errRows.length} with errors</span>
            )}
            <div className="ml-auto">
              <Button onClick={commit} disabled={busy || okRows.length === 0}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Insert {okRows.length} entries
              </Button>
            </div>
          </div>

          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto max-h-[60vh]">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-600 sticky top-0">
                  <tr>
                    <th className="px-2 py-2 text-left">#</th>
                    <th className="px-2 py-2 text-left">Status</th>
                    <th className="px-2 py-2 text-left">Date</th>
                    <th className="px-2 py-2 text-left">Project · sub</th>
                    <th className="px-2 py-2 text-left">Contractor</th>
                    <th className="px-2 py-2 text-left">Item</th>
                    <th className="px-2 py-2 text-right">Qty</th>
                    <th className="px-2 py-2 text-right">Rate</th>
                    <th className="px-2 py-2 text-right">Amount</th>
                    <th className="px-2 py-2 text-left">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const ok = r.errors.length === 0
                    const project = projects.find(p => p.id === r.project_id)
                    const sub     = projects.find(p => p.id === r.sub_project_id)
                    const contractor = contractors.find(c => c.id === r.contractor_id)
                    const item    = items.find(i => i.id === r.item_id)
                    return (
                      <tr key={r.rowNo} className={`border-t border-gray-100 ${ok ? '' : 'bg-rose-50/40'}`}>
                        <td className="px-2 py-1 text-gray-500">{r.rowNo}</td>
                        <td className="px-2 py-1">
                          {ok
                            ? <span className="text-emerald-700 inline-flex items-center gap-0.5"><Check className="h-3 w-3" /> ok</span>
                            : <span className="text-rose-700 inline-flex items-center gap-0.5"><AlertTriangle className="h-3 w-3" /> err</span>}
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap">{r.entry_date || '—'}</td>
                        <td className="px-2 py-1">
                          {project ? `${project.code ?? ''} ${project.name}`.trim() : <span className="text-rose-700">{String(r.raw[Object.keys(r.raw)[1] ?? ''] ?? '')}</span>}
                          {sub && <span className="text-gray-500"> · {sub.name}</span>}
                        </td>
                        <td className="px-2 py-1">{contractor?.name ?? <span className="text-rose-700">{String(r.raw[Object.keys(r.raw)[3] ?? ''] ?? '')}</span>}</td>
                        <td className="px-2 py-1">{item?.name ?? <span className="text-rose-700">{String(r.raw[Object.keys(r.raw)[4] ?? ''] ?? '')}</span>}</td>
                        <td className="px-2 py-1 text-right">{r.quantity ?? '—'} {r.unit}</td>
                        <td className="px-2 py-1 text-right font-mono">{r.rate != null ? formatINR(r.rate) : '—'}</td>
                        <td className="px-2 py-1 text-right font-mono font-semibold">{r.amount != null ? formatINR(r.amount) : '—'}</td>
                        <td className="px-2 py-1 text-rose-700">{r.errors.join('; ')}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {result && (
        <Card className={`p-4 ${result.failed > 0 ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
          <p className="text-sm font-bold text-gray-900">
            Inserted {result.inserted} entries
            {result.failed > 0 ? `, ${result.failed} failed` : '.'}
          </p>
          {result.failed > 0 && (
            <p className="text-xs text-gray-700 mt-1">
              The failed rows didn&apos;t match RLS or had an issue at insert time. Most common cause: contractor / item / project not visible to your role for that project.
            </p>
          )}
          <div className="mt-3">
            <Button size="sm" variant="outline" onClick={reset}>Import another file</Button>
          </div>
        </Card>
      )}
    </div>
  )
}
