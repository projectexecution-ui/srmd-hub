'use client'
// Bulk-import disciplines (+ optional sub-skills) from an Excel/CSV/TSV
// paste. Upserts by code so the import is idempotent — same file re-run
// updates name/order/UoM instead of duplicating.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, Upload, Check, X, AlertTriangle, ClipboardPaste, Archive } from 'lucide-react'

interface Row {
  disc_code: string
  disc_name: string
  disc_order: number | null
  sub_code: string | null
  sub_name: string | null
  sub_uom: string | null
}

// Heuristic column detection — matches every reasonable header word
// the IN4 export (or a hand-rolled sheet) might throw at us.
function detectHeaderMap(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {}
  headers.forEach((h, i) => {
    const s = String(h ?? '').toLowerCase().trim()
    if (!s) return
    if (map.disc_code  === undefined && /\b(disc(?:ipline)?\s*code|cat(?:egory)?\s*code|^code$|^discipline\s*id$)/.test(s)) map.disc_code = i
    if (map.disc_name  === undefined && /\b(disc(?:ipline)?\s*name|^discipline$|^category$|head|nature)/.test(s)) map.disc_name = i
    if (map.disc_order === undefined && /\b(display\s*order|sort|seq|order)\b/.test(s)) map.disc_order = i
    if (map.sub_code   === undefined && /\b(sub[-\s]*skill\s*code|sub\s*code|item\s*code|skill\s*code)/.test(s)) map.sub_code = i
    if (map.sub_name   === undefined && /\b(sub[-\s]*skill\s*name|sub[-\s]*skill$|skill$|item\s*name|sub\s*name)/.test(s)) map.sub_name = i
    if (map.sub_uom    === undefined && /\b(uom|unit|measure)\b/.test(s))             map.sub_uom = i
  })
  // Position fallback: when headers are missing/odd, use position 0 for
  // discipline code, 1 for name. Best-effort.
  if (map.disc_code === undefined) map.disc_code = 0
  if (map.disc_name === undefined) map.disc_name = 1
  return map
}

function parseAOA(aoa: unknown[][]): { rows: Row[]; error: string | null } {
  if (aoa.length < 2) return { rows: [], error: 'Need at least one header row + one data row' }
  const headers = (aoa[0] ?? []).map(c => String(c ?? ''))
  const map = detectHeaderMap(headers)
  const out: Row[] = []
  for (let i = 1; i < aoa.length; i++) {
    const r = aoa[i] ?? []
    const get = (k: string) => {
      const idx = map[k]
      if (idx == null) return null
      const v = r[idx]
      return v == null ? null : String(v).trim()
    }
    const dc = get('disc_code')
    const dn = get('disc_name')
    if (!dc || !dn) continue
    const order = get('disc_order')
    out.push({
      disc_code: dc,
      disc_name: dn,
      disc_order: order != null && order !== '' && Number.isFinite(Number(order)) ? Number(order) : null,
      sub_code:  get('sub_code'),
      sub_name:  get('sub_name'),
      sub_uom:   get('sub_uom'),
    })
  }
  return { rows: out, error: null }
}

function pasteToAOA(text: string): unknown[][] {
  // Accept TSV (Excel default copy), CSV, or pipe.
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '')
  if (lines.length === 0) return []
  // Pick the most-common delimiter on row 1
  const sample = lines[0]
  const tabs = (sample.match(/\t/g) || []).length
  const pipes = (sample.match(/\|/g) || []).length
  const commas = (sample.match(/,/g) || []).length
  const delim = tabs >= pipes && tabs >= commas ? '\t' : pipes >= commas ? '|' : ','
  return lines.map(l => l.split(delim).map(c => c.trim()))
}

export function ImportPanel({
  unusedDisciplineIds,
}: {
  unusedDisciplineIds: string[]
}) {
  const router = useRouter()
  const [open, setOpen]       = useState(false)
  const [text, setText]       = useState('')
  const [rows, setRows]       = useState<Row[]>([])
  const [parseErr, setParseErr] = useState<string | null>(null)
  const [busy, setBusy]       = useState(false)
  const [result, setResult]   = useState<{ disc_inserted: number; disc_updated: number; sub_inserted: number; sub_updated: number } | null>(null)

  function onParse(textIn: string) {
    setText(textIn)
    setResult(null)
    if (!textIn.trim()) { setRows([]); setParseErr(null); return }
    const { rows: parsed, error } = parseAOA(pasteToAOA(textIn))
    setRows(parsed)
    setParseErr(error)
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setBusy(true); setParseErr(null); setResult(null)
    try {
      const buf = await f.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null })
      const { rows: parsed, error } = parseAOA(aoa as unknown[][])
      setRows(parsed); setParseErr(error)
      // Also reflect the contents in the textarea so the user can edit
      setText((parsed ?? []).map(r => [r.disc_code, r.disc_name, r.disc_order ?? '', r.sub_code ?? '', r.sub_name ?? '', r.sub_uom ?? ''].join('\t')).join('\n'))
    } catch (err) {
      setParseErr(err instanceof Error ? err.message : 'Could not read file')
    } finally {
      setBusy(false)
    }
  }

  const grouped = useMemo(() => {
    const byDisc = new Map<string, { name: string; order: number | null; subs: Array<{ code: string; name: string; uom: string | null }> }>()
    for (const r of rows) {
      let cur = byDisc.get(r.disc_code)
      if (!cur) {
        cur = { name: r.disc_name, order: r.disc_order, subs: [] }
        byDisc.set(r.disc_code, cur)
      } else {
        if (!cur.name && r.disc_name) cur.name = r.disc_name
        if (cur.order == null && r.disc_order != null) cur.order = r.disc_order
      }
      if (r.sub_code && r.sub_name) cur.subs.push({ code: r.sub_code, name: r.sub_name, uom: r.sub_uom })
    }
    return Array.from(byDisc.entries())
  }, [rows])

  async function runImport() {
    if (grouped.length === 0) { setParseErr('Nothing to import — paste some rows first'); return }
    setBusy(true); setParseErr(null)
    const supabase = createClient()

    // 1. Existing disciplines by code → id map
    const codes = grouped.map(([code]) => code)
    const { data: existingDisc } = await supabase
      .from('cc_disciplines')
      .select('id, code')
      .in('code', codes)
    const existingByCode = new Map<string, string>((existingDisc ?? []).map(d => [d.code as string, d.id as string]))

    let discIns = 0, discUpd = 0
    for (const [code, info] of grouped) {
      const existingId = existingByCode.get(code)
      if (existingId) {
        const { error } = await supabase
          .from('cc_disciplines')
          .update({ name: info.name, display_order: info.order, is_archived: false })
          .eq('id', existingId)
        if (error) { setParseErr(`Update ${code}: ${error.message}`); setBusy(false); return }
        discUpd++
      } else {
        const { data, error } = await supabase
          .from('cc_disciplines')
          .insert({ code, name: info.name, display_order: info.order })
          .select('id')
          .single()
        if (error || !data) { setParseErr(`Insert ${code}: ${error?.message ?? 'unknown'}`); setBusy(false); return }
        existingByCode.set(code, data.id as string)
        discIns++
      }
    }

    // 2. Sub-skills upsert per discipline
    let subIns = 0, subUpd = 0
    for (const [code, info] of grouped) {
      if (info.subs.length === 0) continue
      const discId = existingByCode.get(code)!
      const { data: existingSubs } = await supabase
        .from('cc_sub_skills')
        .select('id, code')
        .eq('discipline_id', discId)
        .in('code', info.subs.map(s => s.code))
      const existingSubByCode = new Map<string, string>((existingSubs ?? []).map(s => [s.code as string, s.id as string]))
      for (const s of info.subs) {
        const existingSubId = existingSubByCode.get(s.code)
        if (existingSubId) {
          const { error } = await supabase
            .from('cc_sub_skills')
            .update({ name: s.name, default_uom: s.uom, is_archived: false })
            .eq('id', existingSubId)
          if (error) { setParseErr(`Sub-skill update ${s.code}: ${error.message}`); setBusy(false); return }
          subUpd++
        } else {
          const { error } = await supabase
            .from('cc_sub_skills')
            .insert({ discipline_id: discId, code: s.code, name: s.name, default_uom: s.uom })
          if (error) { setParseErr(`Sub-skill insert ${s.code}: ${error.message}`); setBusy(false); return }
          subIns++
        }
      }
    }

    setBusy(false)
    setResult({ disc_inserted: discIns, disc_updated: discUpd, sub_inserted: subIns, sub_updated: subUpd })
    router.refresh()
  }

  async function archiveUnused() {
    if (unusedDisciplineIds.length === 0) { setParseErr('Nothing to archive — every discipline is used by at least one project'); return }
    if (!confirm(`Archive ${unusedDisciplineIds.length} unused discipline${unusedDisciplineIds.length === 1 ? '' : 's'}? You can restore them later from the Show-archived toggle.`)) return
    setBusy(true); setParseErr(null)
    const { error } = await createClient()
      .from('cc_disciplines')
      .update({ is_archived: true })
      .in('id', unusedDisciplineIds)
    setBusy(false)
    if (error) { setParseErr(error.message); return }
    router.refresh()
  }

  if (!open) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <ClipboardPaste className="h-4 w-4" /> Import from IN4 (paste / Excel)
        </Button>
        <Button size="sm" variant="outline"
          onClick={archiveUnused}
          disabled={busy || unusedDisciplineIds.length === 0}
          className="text-amber-700 hover:bg-amber-50 border-amber-200">
          <Archive className="h-4 w-4" />
          Archive {unusedDisciplineIds.length} unused
        </Button>
      </div>
    )
  }

  return (
    <Card className="p-4 space-y-3 border-blue-200 bg-blue-50/30">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-gray-900">Import disciplines (+ sub-skills)</h3>
          <p className="text-xs text-gray-600 mt-0.5">
            Paste from Excel (Ctrl+C → paste here), or upload a .xlsx. Match by <b>code</b> —
            existing rows are <i>updated</i>, new ones are inserted. Sub-skill columns are optional.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setText(''); setRows([]); setParseErr(null); setResult(null) }}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <label className="inline-flex items-center gap-1.5 text-xs border border-gray-300 hover:border-gray-400 rounded-lg px-3 h-8 cursor-pointer bg-white">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          Upload .xlsx
          <input type="file" accept=".xlsx,.xls,.csv,.tsv" className="hidden" onChange={onFile} disabled={busy} />
        </label>
        <span className="text-[11px] text-gray-500">…or paste rows below</span>
      </div>

      <textarea
        value={text}
        onChange={e => onParse(e.target.value)}
        rows={6}
        placeholder={
          'Headers (any spelling — disc code / disc name / sub code / sub name / uom):\n' +
          'Code\tName\tOrder\tSubCode\tSubName\tUoM\n' +
          '01\tSite Pre-lims\t1\t101\tSite Mobilization\tLS\n' +
          '01\tSite Pre-lims\t1\t102\tHoarding\tsq.m\n' +
          '02\tEarthworks\t2\t201\tExcavation\tcu.m'
        }
        className="w-full rounded-md border border-gray-300 bg-white p-2 text-xs font-mono"
      />

      {parseErr && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1 inline-flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5" /> {parseErr}
        </p>
      )}

      {rows.length > 0 && (
        <div className="rounded-md border border-gray-200 bg-white p-2 max-h-48 overflow-auto">
          <p className="text-[11px] text-gray-500 mb-1">Preview: <b>{grouped.length}</b> discipline{grouped.length === 1 ? '' : 's'} · <b>{rows.filter(r => r.sub_code).length}</b> sub-skill row{rows.filter(r => r.sub_code).length === 1 ? '' : 's'}</p>
          <ul className="text-xs space-y-1">
            {grouped.slice(0, 10).map(([code, info]) => (
              <li key={code} className="font-mono">
                <span className="text-blue-700">{code}</span> · {info.name}
                {info.subs.length > 0 && <span className="text-gray-500"> · {info.subs.length} sub-skill{info.subs.length === 1 ? '' : 's'}</span>}
              </li>
            ))}
            {grouped.length > 10 && <li className="text-gray-500 italic">… +{grouped.length - 10} more</li>}
          </ul>
        </div>
      )}

      {result && (
        <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 inline-flex items-center gap-1.5">
          <Check className="h-3.5 w-3.5" />
          Disciplines: {result.disc_inserted} new + {result.disc_updated} updated · Sub-skills: {result.sub_inserted} new + {result.sub_updated} updated.
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => { setText(''); setRows([]); setParseErr(null); setResult(null) }} disabled={busy}>
          Clear
        </Button>
        <Button size="sm" onClick={runImport} disabled={busy || rows.length === 0}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Import {grouped.length > 0 ? `${grouped.length} discipline${grouped.length === 1 ? '' : 's'}` : ''}
        </Button>
      </div>
    </Card>
  )
}
