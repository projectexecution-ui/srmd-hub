'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { compressImage } from '@/lib/img/compress'
import { Loader2, Upload, FileText, FileSpreadsheet, Image as ImageIcon, FileType, Check, AlertTriangle } from 'lucide-react'
import { DocViewer } from './DocViewer'

export type DocRow = { id: string; name: string | null; kind: string | null; url: string | null; ext: string; uploadedBy?: string | null; on?: string | null }

/** What a document is. 'bill' is the stamped bill — the one the Disc Head
 *  desk cannot forward without (Aksha, 16 Sep 2026, screen B). */
const KINDS = [
  { key: 'bill', label: 'Stamped bill' },
  { key: 'mb', label: 'MB sheet' },
  { key: 'abstract', label: 'Abstract' },
  { key: 'support', label: 'Supporting' },
]
const ACCEPT = 'image/*,application/pdf,.xlsx,.xls,.csv,.doc,.docx'
const isImg = (e: string) => ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(e.toLowerCase())
const isXls = (e: string) => ['xlsx', 'xls', 'csv'].includes(e.toLowerCase())

function DocIcon({ ext }: { ext: string }) {
  if (isImg(ext)) return <ImageIcon className="h-8 w-8 text-blue-300" />
  if (ext === 'pdf') return <FileText className="h-8 w-8 text-rose-300" />
  if (isXls(ext)) return <FileSpreadsheet className="h-8 w-8 text-emerald-400" />
  return <FileType className="h-8 w-8 text-indigo-300" />
}

/** A document the flow expects, and whether it is here. */
export interface RequiredDoc {
  /** The kind(s) that satisfy it. */
  kinds: string[]
  label: string
  /** Where it is refused without — shown as the reason. */
  note: string
  /** True when it is satisfied by something other than an upload — the
   *  abstract read straight from IN4, say. */
  satisfiedBy?: string | null
}

export function Documents({ billId, docs, canAttach, required = [] }: {
  billId: string; docs: DocRow[]; canAttach: boolean; required?: RequiredDoc[]
}) {
  const router = useRouter()
  const supabase = createClient()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [kind, setKind] = useState('bill')
  const [view, setView] = useState<DocRow | null>(null)

  async function onFile(file: File | null) {
    if (!file) return
    setBusy(true); setErr(null)
    try {
      const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
      // Only recompress images — Excel/PDF/Word must upload byte-for-byte.
      const out = isImg(ext) ? await compressImage(file) : file
      const path = `${billId}/${crypto.randomUUID()}.${ext}`
      const { error: upErr } = await supabase.storage.from('bills-booking')
        .upload(path, out, { cacheControl: '3600', contentType: file.type || 'application/octet-stream' })
      if (upErr) { setErr(`Upload failed: ${upErr.message}`); setBusy(false); return }
      const { error } = await supabase.rpc('bb_rpc_add_doc', { p_bill: billId, p_path: path, p_name: file.name, p_kind: kind })
      if (error) { setErr(error.message); setBusy(false); return }
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not attach the document')
    } finally {
      setBusy(false)
    }
  }

  const has = (kinds: string[]) => docs.find(d => d.kind && kinds.includes(d.kind))

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Documents</p>
        {canAttach && (
          <div className="flex items-center gap-2">
            <select value={kind} onChange={e => setKind(e.target.value)} aria-label="Document kind"
                    className="h-9 rounded-md border border-gray-300 bg-white px-2 text-xs">
              {KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
            <label className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Add
              <input type="file" accept={ACCEPT} className="sr-only" onChange={e => onFile(e.target.files?.[0] ?? null)} disabled={busy} />
            </label>
          </div>
        )}
      </div>
      {err && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</p>}

      {/* What the flow asks for, and whether it is here. Said on the card, so
          nobody finds out from a refused button. */}
      {required.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {required.map(r => {
            const d = has(r.kinds)
            const ok = !!d || !!r.satisfiedBy
            return (
              <div key={r.label} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px] ${
                ok ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-300 bg-amber-50'}`}>
                {ok ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />}
                <div className="min-w-0">
                  <b className="text-gray-900">{r.label}</b>
                  <div className="truncate text-[11px] text-gray-500">
                    {d ? `${d.name ?? 'file'}${d.uploadedBy ? ` · ${d.uploadedBy}` : ''}${d.on ? ` · ${d.on}` : ''}`
                      : r.satisfiedBy ?? <span className="font-medium text-amber-800">{r.note}</span>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {canAttach && <p className="text-[11px] text-gray-400">Excel, PDF, images and Word — tap any to preview here, no download needed.</p>}

      {docs.length === 0 ? (
        required.length === 0 && <p className="text-sm text-gray-400">No documents attached yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {docs.map(d => (
            <button key={d.id} onClick={() => setView(d)}
              className="group overflow-hidden rounded-lg border border-gray-200 text-left hover:border-indigo-300">
              <div className="flex h-24 items-center justify-center bg-gray-50">
                {isImg(d.ext) && d.url ? <img src={d.url} alt={d.name ?? ''} className="h-full w-full object-cover" /> : <DocIcon ext={d.ext} />}
              </div>
              <div className="flex items-center gap-1 px-2 py-1.5">
                <span className="truncate text-[11px] text-gray-600">
                  {d.kind ? (KINDS.find(k => k.key === d.kind)?.label ?? d.kind) + ' · ' : ''}{d.name || 'file'}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {view && <DocViewer doc={{ name: view.name, url: view.url, ext: view.ext }} onClose={() => setView(null)} />}
    </Card>
  )
}
