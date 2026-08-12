'use client'
// Shown ONLY on a RETURNED Excel working sheet, to its owning engineer. Lets
// them upload a corrected Excel: the same parser the original upload used reads
// it, then a single atomic DB function (cc_replace_ws_excel) swaps in the new
// numbers — scoped strictly to THIS sheet's id. Older versions (their own rows)
// and the revision chain are never touched. Status stays "returned"; the
// engineer then presses "Send for approval" below.
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Upload, Loader2, FileSpreadsheet, X } from 'lucide-react'
import { toast } from 'sonner'
import { formatINR } from '@/lib/utils'
import { parseExcel, type ParsedRow } from '../new-quick/NewWSQuickForm'

export function ReplaceExcelButton({
  wsId, projectId, currentFileName,
}: {
  wsId: string
  projectId: string
  currentFileName: string | null
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<{ rows: ParsedRow[]; grandTotal: number | null } | null>(null)
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function onPick(f: File) {
    setErr(null); setParsing(true); setFile(f); setParsed(null)
    try {
      const res = await parseExcel(f)
      setParsed({ rows: res.rows, grandTotal: res.grandTotal })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not read that Excel — check the file.')
      setFile(null)
    } finally {
      setParsing(false)
    }
  }

  function reset() { setFile(null); setParsed(null); setErr(null) }

  async function confirmReplace() {
    if (!file || !parsed) return
    setSaving(true); setErr(null)
    const supabase = createClient()

    // 1. Upload the new file to a NEW path — the old file is never deleted, so
    //    nothing is lost even if something goes wrong.
    const ts = Date.now()
    const safe = file.name.replace(/[^A-Za-z0-9._-]/g, '_')
    const path = `${projectId}/${ts}-${safe}`
    const { error: upErr } = await supabase.storage.from('cc-sheets').upload(path, file, {
      cacheControl: '3600', upsert: false,
      contentType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    if (upErr) { setErr(`Upload failed: ${upErr.message}`); setSaving(false); return }

    // 2. Map to the row shape, then run the ONE atomic swap.
    const rows = parsed.rows.map(r => ({
      row_no: r.row_no,
      raw_label: r.raw_label,
      description: r.description,
      unit: r.unit,
      qty: r.qty,
      rate: r.rate,
      amount: r.amount,
      formula_in_amount: r.formula_in_amount,
      rate_breakdown: r.rate_breakdown,
      amount_breakdown: r.amount_breakdown,
      ai_meta: r.ai_meta ?? null,
      source_sheet: null,
      source_cell: null,
      qty_formula: null,
      qty_basis: null,
      qty_note: null,
    }))
    const total = parsed.grandTotal ?? null
    const { error } = await supabase.rpc('cc_replace_ws_excel', {
      p_ws_id: wsId,
      p_source_url: path,
      p_source_name: file.name,
      p_summary_total: total,
      p_total: total,
      p_rows: rows,
    })
    setSaving(false)
    if (error) { setErr(error.message); return }
    toast.success('Revised Excel saved — now press “Send for approval” below.')
    reset()
    router.refresh()
  }

  return (
    <div className="rounded-lg border-2 border-blue-300 bg-blue-50/60 p-4 space-y-2">
      <p className="font-bold text-blue-900 text-sm inline-flex items-center gap-1.5">
        <Upload className="h-4 w-4" /> Upload revised Excel
      </p>
      <p className="text-xs text-blue-800">
        Pick your corrected Excel. It replaces <b>this sheet&apos;s</b> numbers only — older versions
        stay exactly as they are. After it saves, press <b>Send for approval</b> below.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = '' }}
      />

      {!parsed ? (
        <Button
          onClick={() => inputRef.current?.click()}
          disabled={parsing}
          variant="outline"
          className="border-blue-400 text-blue-800 hover:bg-blue-100"
        >
          {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
          {parsing ? 'Reading…' : 'Choose revised Excel'}
        </Button>
      ) : (
        <div className="rounded-md bg-white border border-blue-200 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-stone-800 truncate inline-flex items-center gap-1.5 min-w-0">
              <FileSpreadsheet className="h-4 w-4 text-emerald-600 flex-shrink-0" />
              <span className="truncate">{file?.name}</span>
            </span>
            <button type="button" onClick={reset} className="text-stone-400 hover:text-stone-700 flex-shrink-0" aria-label="Cancel">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-xs text-stone-600">
            {parsed.rows.length} row{parsed.rows.length === 1 ? '' : 's'} · new total{' '}
            <b className="text-stone-900">{parsed.grandTotal != null ? formatINR(parsed.grandTotal) : '—'}</b>
          </p>
          {currentFileName && <p className="text-[11px] text-stone-400 truncate">Replacing: {currentFileName}</p>}
          <div className="flex gap-2">
            <Button onClick={confirmReplace} disabled={saving} className="bg-blue-700 hover:bg-blue-800">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Replace with this file
            </Button>
            <Button variant="ghost" onClick={reset} disabled={saving}>Cancel</Button>
          </div>
        </div>
      )}

      {err && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1">{err}</p>}
    </div>
  )
}
