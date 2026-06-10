'use client'
// Client-side UX for pulling a BPH project's budget into Cost Control.
// Three states:
//   1. Match — pick BPH source + CT Hub target
//   2. Preview — show every row with match status (matched / unmatched);
//      uncheckable per-row so the PM can skip rogue lines
//   3. Result — final inserted / updated / skipped counts + any errors

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Loader2, ArrowRight, Check, X, AlertTriangle, FileSpreadsheet, Sparkles } from 'lucide-react'
import { formatINR } from '@/lib/utils'
import { previewBphImport, commitBphImport, type BphProjectSummary, type BphMatchedRow, type CommitOutcome } from './actions'

interface CcProject { id: string; code: string; name: string }

export function BphImportClient({
  bphProjects,
  ccProjects,
  defaultCcProjectId,
}: {
  bphProjects: BphProjectSummary[]
  ccProjects: CcProject[]
  defaultCcProjectId: string | null
}) {
  const router = useRouter()
  const [bphId, setBphId] = useState('')
  const [ccId, setCcId]   = useState(defaultCcProjectId ?? '')
  const [preview, setPreview] = useState<{
    bph_project_name: string
    cc_project_label: string
    rows: BphMatchedRow[]
    stats: { total_rows: number; importable_rows: number; unmatched_rows: number; ai_matched_rows: number; will_enable_count: number; total_budget: number }
  } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<CommitOutcome | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const bph = bphProjects.find(b => b.id === bphId)
  const cc  = ccProjects.find(c => c.id === ccId)

  function doPreview() {
    if (!bphId || !ccId) return
    setErr(null)
    setResult(null)
    startTransition(async () => {
      const res = await previewBphImport({ bph_project_id: bphId, cc_project_id: ccId })
      if (!res.ok) { setErr(res.error); return }
      setPreview({
        bph_project_name: res.bph_project_name,
        cc_project_label: res.cc_project_label,
        rows: res.rows,
        stats: res.stats,
      })
      // Pre-select all importable rows
      setSelected(new Set(res.rows.filter(r => r.importable).map(r => r.key)))
    })
  }

  function doCommit() {
    if (!preview || !bphId || !ccId) return
    setErr(null)
    startTransition(async () => {
      const res = await commitBphImport({
        bph_project_id: bphId,
        cc_project_id: ccId,
        row_keys: Array.from(selected),
      })
      if (!res.ok) { setErr(res.error); return }
      setResult(res)
      router.refresh()
    })
  }

  function reset() {
    setPreview(null); setSelected(new Set()); setResult(null); setErr(null)
  }

  function toggleRow(key: string) {
    setSelected(s => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n })
  }

  // ─── Step 1: match BPH ↔ CT project ─────────────────────────────────
  if (!preview) {
    return (
      <Card className="p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-end">
          <div>
            <Label>Source — BPH project (from /budget)</Label>
            <select
              value={bphId}
              onChange={e => setBphId(e.target.value)}
              className="mt-1 flex h-10 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">— Select BPH project —</option>
              {bphProjects.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.location ? ` · ${p.location}` : ''} · {p.row_count} rows · {formatINR(p.total_budget)}
                </option>
              ))}
            </select>
            {bph && (
              <p className="text-[11px] text-gray-500 mt-1">
                {bph.row_count} parsed rows · budget {formatINR(bph.total_budget)} · actual {formatINR(bph.total_actual)}
              </p>
            )}
          </div>

          <ArrowRight className="h-5 w-5 text-gray-400 mb-3 hidden md:block" />

          <div>
            <Label>Target — Cost Control project</Label>
            <select
              value={ccId}
              onChange={e => setCcId(e.target.value)}
              className="mt-1 flex h-10 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">— Select CT Hub project —</option>
              {ccProjects.map(p => (
                <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
              ))}
            </select>
            {cc && bph && bph.name.replace(/\s+/g, '').toLowerCase() === cc.code.replace(/\s+/g, '').toLowerCase() && (
              <p className="text-[11px] text-emerald-700 mt-1 inline-flex items-center gap-0.5">
                <Check className="h-3 w-3" /> Names match — looks like the right pair
              </p>
            )}
          </div>
        </div>

        {err && <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">{err}</p>}

        <div className="flex justify-end">
          <Button onClick={doPreview} disabled={!bphId || !ccId || pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            Preview rows
          </Button>
        </div>
      </Card>
    )
  }

  // ─── Step 3: result panel ───────────────────────────────────────────
  if (result) {
    return (
      <Card className="p-5 space-y-4">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
          <p className="text-sm font-semibold text-emerald-900 inline-flex items-center gap-2">
            <Check className="h-4 w-4" />
            BPH pull complete
          </p>
          <p className="text-xs text-emerald-800 mt-1">
            <b>{result.inserted}</b> new budget line{result.inserted === 1 ? '' : 's'} ·{' '}
            <b>{result.updated}</b> updated · {result.skipped > 0 && <span className="text-amber-700"><b>{result.skipped}</b> skipped · </span>}
            <Link href={`/cost-control/projects/${ccId}`} className="text-blue-700 hover:underline font-medium">
              See it on {cc?.code} →
            </Link>
          </p>
        </div>
        {result.errors.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 space-y-1">
            <p className="text-xs font-semibold text-amber-900 inline-flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" /> Some rows failed
            </p>
            <ul className="text-[11px] text-amber-800 list-disc ml-5">
              {result.errors.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}
              {result.errors.length > 10 && <li>… +{result.errors.length - 10} more</li>}
            </ul>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={reset}>
            Pull another project
          </Button>
        </div>
      </Card>
    )
  }

  // ─── Step 2: preview & select ───────────────────────────────────────
  const selectedCount = preview.rows.filter(r => selected.has(r.key)).length
  const selectedTotal = preview.rows.filter(r => selected.has(r.key)).reduce((s, r) => s + r.budget, 0)
  const allImportable = preview.rows.filter(r => r.importable)
  const allSelected = allImportable.length > 0 && selectedCount === allImportable.length

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-gray-700">
          <FileSpreadsheet className="h-4 w-4 text-blue-600 inline mr-1" />
          <span className="font-semibold text-gray-900">{preview.bph_project_name}</span> → <span className="font-semibold text-gray-900">{preview.cc_project_label}</span>
          <span className="ml-2 text-xs text-gray-500">
            {preview.stats.importable_rows} importable · {preview.stats.unmatched_rows} unmatched
            {preview.stats.ai_matched_rows > 0 && <span className="text-violet-700"> · {preview.stats.ai_matched_rows} AI-matched</span>}
            {preview.stats.will_enable_count > 0 && <span className="text-blue-700"> · {preview.stats.will_enable_count} will enable in setup</span>}
            {' · '}{formatINR(preview.stats.total_budget)} total
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={reset}>
          <X className="h-3.5 w-3.5" /> Change mapping
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={el => { if (el) el.indeterminate = selectedCount > 0 && !allSelected }}
                  onChange={() => {
                    if (allSelected) setSelected(new Set())
                    else setSelected(new Set(allImportable.map(r => r.key)))
                  }}
                />
              </th>
              <th className="px-3 py-2 font-semibold">Head (from BPH)</th>
              <th className="px-3 py-2 font-semibold">Matched discipline</th>
              <th className="px-3 py-2 font-semibold">Sub-skill</th>
              <th className="px-3 py-2 font-semibold text-right">Budget</th>
              <th className="px-3 py-2 font-semibold text-right">WO approved</th>
              <th className="px-3 py-2 font-semibold text-right">Actual</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map(r => (
              <tr key={r.key} className={`border-t border-gray-100 ${
                !r.importable ? 'bg-rose-50/30' : selected.has(r.key) ? 'bg-emerald-50/30' : 'hover:bg-gray-50/50'
              }`}>
                <td className="px-3 py-2.5">
                  {r.importable ? (
                    <input
                      type="checkbox"
                      checked={selected.has(r.key)}
                      onChange={() => toggleRow(r.key)}
                    />
                  ) : (
                    <X className="h-3.5 w-3.5 text-rose-500" />
                  )}
                </td>
                <td className="px-3 py-2.5 text-gray-900">
                  <p className="font-medium truncate max-w-[240px]" title={r.head}>{r.head}</p>
                  <p className="text-[10px] text-gray-400 font-mono">cat {r.catNum || '—'}{r.subNum ? ` · sub ${r.subNum}` : ''}</p>
                </td>
                <td className="px-3 py-2.5 text-xs">
                  {r.matched_discipline_label ? (
                    <span className="inline-flex items-center gap-1 flex-wrap">
                      <span className="text-emerald-700">{r.matched_discipline_label}</span>
                      {r.match_source === 'ai' && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-violet-700 bg-violet-50 border border-violet-200 rounded px-1"
                          title={`Matched by AI on name${r.ai_confidence != null ? ` · ${Math.round(r.ai_confidence * 100)}% confident` : ''} — code didn't match, please verify`}>
                          <Sparkles className="h-2.5 w-2.5" /> AI{r.ai_confidence != null ? ` ${Math.round(r.ai_confidence * 100)}%` : ''}
                        </span>
                      )}
                      {r.will_enable_discipline && (
                        <span className="text-[9px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded px-1"
                          title="This discipline isn't enabled in the project setup — importing will enable it">
                          + enable
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-rose-700 inline-flex items-center gap-0.5">
                      <AlertTriangle className="h-3 w-3" /> no match for cat {r.catNum || '(blank)'}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-xs text-gray-700">
                  {r.matched_sub_skill_label
                    ? <span className="inline-flex items-center gap-1 flex-wrap">
                        {r.matched_sub_skill_label}
                        {r.will_enable_sub_skill && (
                          <span className="text-[9px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded px-1"
                            title="This sub-skill isn't enabled in the project setup — importing will enable it">
                            + enable
                          </span>
                        )}
                      </span>
                    : r.subNum
                      ? <span className="text-amber-700">no sub-skill {r.subNum} → rolls up to discipline</span>
                      : <span className="text-gray-400">(rolls up to discipline)</span>}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-gray-900">{formatINR(r.budget)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{formatINR(r.woApproved)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{formatINR(r.actual)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-gray-200 bg-gray-50 p-4 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-gray-700">
          <b>{selectedCount}</b> row{selectedCount === 1 ? '' : 's'} selected · total {formatINR(selectedTotal)}
        </p>
        {err && <p className="text-xs text-rose-700">{err}</p>}
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={reset} disabled={pending}>Back</Button>
          <Button onClick={doCommit} disabled={selectedCount === 0 || pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Pull {selectedCount} row{selectedCount === 1 ? '' : 's'} into {cc?.code}
          </Button>
        </div>
      </div>
    </Card>
  )
}
