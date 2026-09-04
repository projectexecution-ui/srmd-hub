'use client'
// V2 Upload — single page where the uploader drops all three Excels.
// Contractor + Supplier are parsed and saved in-place via the same APIs the
// originals use (so the originals + V2 both stay fresh, and no original code
// changes). Budget BPH is launched into the existing iframe-based uploader at
// /budget — its parser lives there as vanilla JS and we deliberately don't
// reimplement it here.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import * as XLSX from 'xlsx'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { UploadCloud, Loader2, CheckCircle2, ExternalLink, ListTree, FileSpreadsheet, Receipt, Users } from 'lucide-react'
import { cn, istAgeLabel } from '@/lib/utils'
import {
  parseSourceReports as parseContractor,
  type ReportDoc as ContractorDoc,
} from '@/lib/contractor-report'
import {
  parseSourceReports as parseSupplier,
  type ReportDoc as SupplierDoc,
} from '@/lib/supplier-report'

type Kind = 'budget' | 'contractor' | 'supplier'
const CONTRACTOR_URL = '/api/contractor-report/state'
const SUPPLIER_URL = '/api/supplier-report/state'

// IST calendar days — see istAgeLabel. Dividing elapsed ms by 24h called an
// upload from yesterday afternoon "today".
function fmtAge(iso: string | null): string {
  if (!iso) return 'no upload yet'
  return istAgeLabel(iso).text
}

interface StateMeta { at: string | null; by: string | null }

export default function UploadClient({ live = { budget: false, contractor: false, supplier: false } }: { live?: Record<Kind, boolean> }) {
  const [meta, setMeta] = useState<Record<Kind, StateMeta>>({
    budget: { at: null, by: null }, contractor: { at: null, by: null }, supplier: { at: null, by: null },
  })
  const [busy, setBusy] = useState<Kind | null>(null)

  const loadMeta = useCallback(async () => {
    const fetchOne = async (kind: Kind, url: string): Promise<StateMeta> => {
      try {
        const r = await fetch(url, { cache: 'no-store' })
        if (!r.ok) return { at: null, by: null }
        const j = await r.json()
        return { at: j.updated_at ?? null, by: j.updated_by_name ?? null }
      } catch { return { at: null, by: null } }
    }
    const [b, c, s] = await Promise.all([
      fetchOne('budget', '/api/budget-hub/state'),
      fetchOne('contractor', CONTRACTOR_URL),
      fetchOne('supplier', SUPPLIER_URL),
    ])
    setMeta({ budget: b, contractor: c, supplier: s })
  }, [])

  useEffect(() => { loadMeta() }, [loadMeta])

  // Persist helper for the contractor / supplier endpoints — they both follow
  // the same shape: GET → mutate({reports, settings}) → PUT.
  type CSDoc = ContractorDoc | SupplierDoc
  type CSState = { reports: CSDoc[]; settings?: Record<string, unknown> }
  async function persistMerge(url: string, incoming: CSDoc[]): Promise<{ added: number; replaced: number }> {
    const cur = await (await fetch(url, { cache: 'no-store' })).json()
    const curState: CSState = { reports: cur.state?.reports ?? [], settings: cur.state?.settings ?? {} }
    let added = 0, replaced = 0
    let out = curState.reports
    for (const doc of incoming) {
      const i = out.findIndex(r => r.projectName === doc.projectName)
      if (i >= 0) { out = out.map((r, j) => j === i ? { ...doc, areaBySub: (out[i] as { areaBySub?: Record<string, number> }).areaBySub } : r); replaced++ }
      else { out = [...out, doc]; added++ }
    }
    const put = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: { ...curState, reports: out }, baseVersion: cur.version, force: true }),
    })
    if (!put.ok) { const j = await put.json().catch(() => ({})); throw new Error(j.error || 'Save failed') }
    return { added, replaced }
  }

  async function readWorkbookRows(file: File): Promise<(string | number | null)[][]> {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(new Uint8Array(buf), { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    if (!ws) throw new Error('Workbook has no sheets')
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true }) as (string | number | null)[][]
  }

  async function handleContractor(file: File) {
    setBusy('contractor')
    try {
      const rows = await readWorkbookRows(file)
      const parsed = parseContractor(rows).filter(p => p.subprojects.length > 0)
      if (parsed.length === 0) throw new Error('No contractor rows — is this the IN4 “All Types Certificates Details” export?')
      const now = new Date().toISOString()
      const docs: ContractorDoc[] = parsed.map(p => ({
        id: crypto.randomUUID(), projectName: p.projectName, title: p.title, subtitle: p.subtitle,
        sourceFilename: file.name, uploadedAt: now, subprojects: p.subprojects, computed: p.computed, source: p.source,
      }))
      const { added, replaced } = await persistMerge(CONTRACTOR_URL, docs)
      toast.success(`Contractor: saved ${added + replaced} project${added + replaced === 1 ? '' : 's'} (${replaced} updated · ${added} new)`)
      await loadMeta()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Upload failed') }
    finally { setBusy(null) }
  }

  async function handleSupplier(file: File) {
    setBusy('supplier')
    try {
      const rows = await readWorkbookRows(file)
      const parsed = parseSupplier(rows).filter(p => p.subprojects.length > 0)
      if (parsed.length === 0) throw new Error('No supplier rows — is this the IN4 “All Purchase Payments Report”?')
      const now = new Date().toISOString()
      const docs: SupplierDoc[] = parsed.map(p => ({
        id: crypto.randomUUID(), projectName: p.projectName, title: p.title, subtitle: p.subtitle,
        sourceFilename: file.name, uploadedAt: now, subprojects: p.subprojects, computedBill: p.computedBill, source: p.source,
      }))
      const { added, replaced } = await persistMerge(SUPPLIER_URL, docs)
      toast.success(`Supplier: saved ${added + replaced} project${added + replaced === 1 ? '' : 's'} (${replaced} updated · ${added} new)`)
      await loadMeta()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Upload failed') }
    finally { setBusy(null) }
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <PageHeader title="Upload — Budget vs Actual V2" back="/budget-vs-actual-v2"
        subtitle="Drop the three IN4 Excels here. Each goes straight to its module — V2, Contractor and Supplier all update together." />

      {(live.budget || live.contractor || live.supplier) && (
        <Card className="p-3 bg-emerald-50 border-emerald-200 text-[12px] text-emerald-900 leading-relaxed">
          Live from IN4, twice a day — no Excel needed: {[live.budget && 'Budget', live.contractor && 'Contractor', live.supplier && 'Supplier'].filter(Boolean).join(', ')}.
          The tiles below stay as a fallback. <Link className="underline" href="/admin/in4">IN4 live sync</Link>
        </Card>
      )}
      <Card className="p-3 bg-blue-50 border-blue-200 text-[12px] text-blue-900 leading-relaxed">
        Same files you upload today, in one place. Contractor &amp; Supplier save here directly.
        Budget BPH still uses its own uploader at <Link className="underline" href="/budget">Budget vs Actual</Link> — click the tile below.
      </Card>

      <DropTile
        title="Contractor payments"
        sub="IN4 → Reports → Purchase → “All Types Certificates Details” (.xlsx)"
        icon={<Users className="h-5 w-5" />}
        accent="violet"
        lastAt={meta.contractor.at}
        lastBy={meta.contractor.by}
        busy={busy === 'contractor'}
        onDrop={handleContractor}
      />

      <DropTile
        title="Supplier payments"
        sub="IN4 → Reports → Purchase → “All Purchase Payments Report” (.xlsx)"
        icon={<Receipt className="h-5 w-5" />}
        accent="blue"
        lastAt={meta.supplier.at}
        lastBy={meta.supplier.by}
        busy={busy === 'supplier'}
        onDrop={handleSupplier}
      />

      {/* Budget BPH launcher — its parser lives in the iframe app. */}
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center flex-shrink-0">
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-gray-900">Budget vs Actual (BPH)</span>
              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">opens in original page</span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">IN4 → Reports → Budget Performance / Hierarchy report</p>
            <p className="text-[11px] text-gray-400 mt-1">Last updated: <b className="text-gray-600">{fmtAge(meta.budget.at)}</b>{meta.budget.by ? <> · by {meta.budget.by}</> : null}</p>
          </div>
          <Link href="/budget"
            className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">
            Open Budget uploader <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      </Card>

      <div className="flex justify-end pt-2">
        <Link href="/budget-vs-actual-v2" className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800">
          <ListTree className="h-4 w-4" /> Back to V2 tree
        </Link>
      </div>
    </div>
  )
}

function DropTile({
  title, sub, icon, accent, lastAt, lastBy, busy, onDrop,
}: {
  title: string
  sub: string
  icon: React.ReactNode
  accent: 'violet' | 'blue'
  lastAt: string | null
  lastBy: string | null
  busy: boolean
  onDrop: (file: File) => void | Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [hover, setHover] = useState(false)
  const tone = accent === 'violet'
    ? 'bg-violet-50 text-violet-700 border-violet-200'
    : 'bg-blue-50 text-blue-700 border-blue-200'
  const hoverTone = accent === 'violet' ? 'border-violet-300 bg-violet-50/30' : 'border-blue-300 bg-blue-50/30'

  function isFileDrag(e: React.DragEvent): boolean {
    const types = e.dataTransfer?.types
    if (!types) return false
    for (let i = 0; i < types.length; i++) if (types[i] === 'Files') return true
    return false
  }

  return (
    <Card
      className={cn('p-4 border-2 border-dashed transition-colors', hover ? hoverTone : 'border-gray-200')}
      onDragEnter={e => { if (isFileDrag(e)) { e.preventDefault(); setHover(true) } }}
      onDragOver={e => { if (isFileDrag(e)) e.preventDefault() }}
      onDragLeave={e => { if (isFileDrag(e)) { e.preventDefault(); setHover(false) } }}
      onDrop={e => {
        if (!isFileDrag(e)) return
        e.preventDefault(); setHover(false)
        const f = e.dataTransfer.files?.[0]
        if (f && /\.xlsx?$/i.test(f.name)) onDrop(f)
        else toast.error('Drop an .xlsx file')
      }}
    >
      <div className="flex items-start gap-3">
        <div className={cn('h-10 w-10 rounded-xl border flex items-center justify-center flex-shrink-0', tone)}>{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-900">{title}</span>
            {lastAt && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{sub}</p>
          <p className="text-[11px] text-gray-400 mt-1">
            Last updated: <b className="text-gray-600">{fmtAge(lastAt)}</b>{lastBy ? <> · by {lastBy}</> : null}
          </p>
        </div>
        <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) { onDrop(f); e.target.value = '' } }} />
        <Button size="sm" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          {busy ? 'Saving…' : 'Choose file'}
        </Button>
      </div>
      <p className="text-[11px] text-gray-400 mt-2">…or drag the .xlsx anywhere onto this card.</p>
    </Card>
  )
}
