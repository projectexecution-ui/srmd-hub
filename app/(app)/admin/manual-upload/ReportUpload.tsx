'use client'
// Hand-upload of an IN4 report Excel when the live read is down.
//
// Contractor: IN4's "All Types Certificates Details" export.
// Supplier:   IN4's "All Purchase Payments Report" export.
//
// Same path the old report screens took (parse in the browser with xlsx, one
// ReportDoc per project, PUT the whole state with force): the Reports tab and
// the Accounts figures read the state tables, so an upload here shows up there.

import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { UploadCloud, Loader2, CheckCircle2, AlertTriangle, FileSpreadsheet } from 'lucide-react'
import { parseSourceReports as parseContractor, type ReportDoc as ContractorDoc } from '@/lib/contractor-report'
import { parseSourceReports as parseSupplier, type ReportDoc as SupplierDoc } from '@/lib/supplier-report'
import { formatDateTime } from '@/lib/utils'

type Kind = 'contractor' | 'supplier'
type AnyDoc = ContractorDoc | SupplierDoc
type FullState = { reports: AnyDoc[]; settings: Record<string, unknown> }

const META: Record<Kind, { title: string; sheet: string; url: string; empty: string }> = {
  contractor: { title: 'Contractor certificates', sheet: 'IN4 → All Types Certificates Details (.xlsx)', url: '/api/contractor-report/state', empty: 'No contractor rows found — is this the “All Types Certificates Details” export?' },
  supplier:   { title: 'Supplier payments',       sheet: 'IN4 → All Purchase Payments Report (.xlsx)',    url: '/api/supplier-report/state',   empty: 'No supplier rows found — is this the “All Purchase Payments Report” export?' },
}

function sheetRows(buf: ArrayBuffer): (string | number | null)[][] {
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) throw new Error('Workbook has no sheets')
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true }) as (string | number | null)[][]
}

async function parseFile(kind: Kind, file: File): Promise<AnyDoc[]> {
  const rows = sheetRows(await file.arrayBuffer())
  const uploadedAt = new Date().toISOString()
  if (kind === 'contractor') {
    const parsed = parseContractor(rows).filter(p => p.subprojects.length > 0)
    if (parsed.length === 0) throw new Error(META.contractor.empty)
    return parsed.map(p => ({ id: crypto.randomUUID(), projectName: p.projectName, title: p.title, subtitle: p.subtitle, sourceFilename: file.name, uploadedAt, subprojects: p.subprojects, computed: p.computed, source: p.source } satisfies ContractorDoc))
  }
  const parsed = parseSupplier(rows).filter(p => p.subprojects.length > 0)
  if (parsed.length === 0) throw new Error(META.supplier.empty)
  return parsed.map(p => ({ id: crypto.randomUUID(), projectName: p.projectName, title: p.title, subtitle: p.subtitle, sourceFilename: file.name, uploadedAt, subprojects: p.subprojects, computedBill: p.computedBill, source: p.source } satisfies SupplierDoc))
}

export function ReportUpload({ kind }: { kind: Kind }) {
  const meta = META[kind]
  const [saved, setSaved] = useState<Array<{ projectName: string; uploadedAt: string; sourceFilename: string }>>([])
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function refresh() {
    const r = await fetch(meta.url, { cache: 'no-store' })
    if (!r.ok) return
    const j = await r.json()
    const docs = (j.state?.reports ?? []) as AnyDoc[]
    setSaved(docs.map(d => ({ projectName: d.projectName, uploadedAt: d.uploadedAt, sourceFilename: d.sourceFilename })).sort((a, b) => a.projectName.localeCompare(b.projectName)))
    setUpdatedAt(j.updated_at ?? null)
  }
  // What is on file today, read once on open (the state updates only after the fetch resolves).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(meta.url, { cache: 'no-store' })
        if (!r.ok || cancelled) return
        const j = await r.json()
        if (cancelled) return
        const docs = (j.state?.reports ?? []) as AnyDoc[]
        setSaved(docs.map(d => ({ projectName: d.projectName, uploadedAt: d.uploadedAt, sourceFilename: d.sourceFilename })).sort((a, b) => a.projectName.localeCompare(b.projectName)))
        setUpdatedAt(j.updated_at ?? null)
      } catch { /* the panel still works without the list */ }
    })()
    return () => { cancelled = true }
  }, [meta.url])

  async function onFiles(files: FileList | null) {
    if (!files?.length) return
    setBusy(true); setMsg(null)
    try {
      const incoming: AnyDoc[] = []
      for (const f of Array.from(files)) incoming.push(...await parseFile(kind, f))
      const cur = await (await fetch(meta.url, { cache: 'no-store' })).json()
      const state: FullState = { reports: (cur.state?.reports ?? []) as AnyDoc[], settings: cur.state?.settings ?? {} }
      // One document per project: the upload replaces that project's earlier one.
      const replaced = new Set(incoming.map(d => d.projectName))
      const next: FullState = { reports: [...state.reports.filter(d => !replaced.has(d.projectName)), ...incoming], settings: state.settings }
      const put = await fetch(meta.url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state: next, baseVersion: cur.version, force: true }) })
      const j = await put.json().catch(() => ({}))
      if (!put.ok) throw new Error(j.error || 'Save failed')
      setMsg({ ok: true, text: `Saved ${incoming.length} project${incoming.length === 1 ? '' : 's'}: ${incoming.map(d => d.projectName).join(', ')}` })
      await refresh()
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex items-start gap-2">
        <FileSpreadsheet className="h-4 w-4 mt-0.5 text-teal-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900">{meta.title}</p>
          <p className="text-[12px] text-gray-500">{meta.sheet}{updatedAt ? ` · last saved ${formatDateTime(updatedAt)}` : ''}</p>
        </div>
      </div>
      <label className={`flex items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-5 text-sm cursor-pointer min-h-[64px] ${busy ? 'border-gray-200 text-gray-400' : 'border-teal-300 text-teal-800 hover:bg-teal-50'}`}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
        {busy ? 'Reading and saving…' : 'Choose the Excel file (one or more)'}
        <input type="file" accept=".xlsx,.xls" multiple className="hidden" disabled={busy} onChange={e => { void onFiles(e.target.files); e.target.value = '' }} />
      </label>
      {msg && (
        <p className={`text-xs inline-flex items-start gap-1.5 ${msg.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
          {msg.ok ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5" /> : <AlertTriangle className="h-3.5 w-3.5 mt-0.5" />}{msg.text}
        </p>
      )}
      {saved.length > 0 && (
        <details className="text-[12px] text-gray-600">
          <summary className="cursor-pointer select-none">{saved.length} project{saved.length === 1 ? '' : 's'} on file</summary>
          <ul className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
            {saved.map(s => <li key={s.projectName} className="truncate">{s.projectName} <span className="text-gray-400">· {formatDateTime(s.uploadedAt)}</span></li>)}
          </ul>
        </details>
      )}
    </section>
  )
}
