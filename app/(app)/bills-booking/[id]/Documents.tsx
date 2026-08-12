'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { compressImage } from '@/lib/img/compress'
import { Loader2, Upload, FileText, FileSpreadsheet, Image as ImageIcon, FileType } from 'lucide-react'
import { DocViewer } from './DocViewer'

export type DocRow = { id: string; name: string | null; kind: string | null; url: string | null; ext: string }

const KINDS = [
  { key: 'bill', label: 'Bill' },
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

export function Documents({ billId, docs, canEdit }: { billId: string; docs: DocRow[]; canEdit: boolean }) {
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

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Documents</p>
        {canEdit && (
          <div className="flex items-center gap-2">
            <select value={kind} onChange={e => setKind(e.target.value)} className="h-8 rounded-md border border-gray-300 bg-white px-2 text-xs">
              {KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Add
              <input type="file" accept={ACCEPT} className="sr-only" onChange={e => onFile(e.target.files?.[0] ?? null)} disabled={busy} />
            </label>
          </div>
        )}
      </div>
      {err && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</p>}
      {canEdit && <p className="text-[11px] text-gray-400">Excel, PDF, images and Word — tap any to preview here, no download needed.</p>}

      {docs.length === 0 ? (
        <p className="text-sm text-gray-400">No documents attached yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {docs.map(d => (
            <button key={d.id} onClick={() => setView(d)}
              className="group overflow-hidden rounded-lg border border-gray-200 text-left hover:border-indigo-300">
              <div className="flex h-24 items-center justify-center bg-gray-50">
                {isImg(d.ext) && d.url ? <img src={d.url} alt={d.name ?? ''} className="h-full w-full object-cover" /> : <DocIcon ext={d.ext} />}
              </div>
              <div className="flex items-center gap-1 px-2 py-1.5">
                <span className="truncate text-[11px] text-gray-600">{d.kind ? d.kind + ' · ' : ''}{d.name || 'file'}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {view && <DocViewer doc={{ name: view.name, url: view.url, ext: view.ext }} onClose={() => setView(null)} />}
    </Card>
  )
}
