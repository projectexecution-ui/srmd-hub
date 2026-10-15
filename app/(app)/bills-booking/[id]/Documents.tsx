'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { compressImage } from '@/lib/img/compress'
import { Loader2, Upload, FileText, FileSpreadsheet, Image as ImageIcon, FileType, Check, AlertTriangle, MessageSquareWarning, X } from 'lucide-react'
import { DocViewer } from './DocViewer'

export type DocRow = { id: string; name: string | null; kind: string | null; url: string | null; ext: string; uploadedBy?: string | null; on?: string | null }

/** What a document is. The keys are what the checklist in the database
 *  (bb_doc_checklist) asks for by kind; the labels are what people read. */
export const KINDS = [
  { key: 'bill',         label: 'Stamped bill / invoice' },
  { key: 'mb',           label: 'Certified RA measurement sheet' },
  { key: 'marking_plan', label: 'Marking plan / as-built drawing' },
  { key: 'no_due',       label: 'No-Due certificate' },
  { key: 'vcc',          label: 'Virtual Completion Certificate' },
  { key: 'warranty',     label: 'Warranty / guarantee / bond' },
  { key: 'abstract',     label: 'Abstract' },
  { key: 'support',      label: 'Supporting' },
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

/** One line of the bill's checklist, as the database reports it.
 *
 *  Ambrish (Engineer, SRM) on the go-live guide, 14 Oct 2026, asked for a
 *  mandatory document list at the Site Head. Aksha, 15 Oct: the list depends
 *  on the kind of bill, the bill waits at the Site Head until everything is
 *  attached, and a document the Site Head cannot attach needs a REASON — the
 *  Disc Head, Project Head and Atm Head are told, and only then does it move.
 *
 *  The list itself lives in SQL (bb_doc_checklist); this only draws it. */
export interface ChecklistRow {
  kind: string
  label: string
  finalOnly: boolean
  state: 'attached' | 'waived' | 'missing' | 'in4'
  /** attached: file name · who · when */
  docName?: string | null
  docBy?: string | null
  docOn?: string | null
  /** waived: the Site Head's reason · who · when */
  reason?: string | null
  waivedBy?: string | null
  waivedOn?: string | null
  /** in4: the measurement, read back — nothing to upload */
  note?: string | null
}

export function Documents({ billId, docs, canAttach, checklist = [], canWaive = false }: {
  billId: string; docs: DocRow[]; canAttach: boolean
  checklist?: ChecklistRow[]
  /** The Site Head, on a bill at the Site Head: may say a document is not
   *  available and why. Nobody else, nowhere else. */
  canWaive?: boolean
}) {
  const router = useRouter()
  const supabase = createClient()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [kind, setKind] = useState('bill')
  const [view, setView] = useState<DocRow | null>(null)
  const [ask, setAsk] = useState<ChecklistRow | null>(null)
  const [reason, setReason] = useState('')
  const dlg = useRef<HTMLDialogElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

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

  /** "Attach" on a checklist line: pre-pick its kind and open the file box. */
  function attachFor(k: string) {
    setKind(k)
    fileInput.current?.click()
  }

  function openReason(row: ChecklistRow) {
    setAsk(row); setReason(row.reason ?? ''); setErr(null); dlg.current?.showModal()
  }
  async function saveReason() {
    if (!ask) return
    if (reason.trim().length < 8) { setErr('Say why — eight characters is the least that says anything.'); return }
    setBusy(true)
    const { error } = await supabase.rpc('bb_rpc_waive_doc', { p_bill: billId, p_kind: ask.kind, p_reason: reason.trim() })
    setBusy(false)
    if (error) { setErr(error.message); return }
    dlg.current?.close()
    router.refresh()
  }
  async function withdraw(row: ChecklistRow) {
    setBusy(true); setErr(null)
    const { error } = await supabase.rpc('bb_rpc_unwaive_doc', { p_bill: billId, p_kind: row.kind })
    setBusy(false)
    if (error) { setErr(error.message); return }
    router.refresh()
  }

  const missing = checklist.filter(r => r.state === 'missing').length
  const waived = checklist.filter(r => r.state === 'waived').length

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-400">
          Documents
          {checklist.length > 0 && (
            <span className="ml-2 font-semibold normal-case tracking-normal text-gray-500">
              {missing === 0
                ? <span className="text-emerald-700">checklist complete{waived > 0 ? ` · ${waived} with a reason` : ''}</span>
                : <span className="text-amber-800">{missing} of {checklist.length} still to attach</span>}
            </span>
          )}
        </p>
        {canAttach && (
          <div className="flex items-center gap-2">
            <select value={kind} onChange={e => setKind(e.target.value)} aria-label="Document kind"
                    className="h-9 rounded-md border border-gray-300 bg-white px-2 text-xs">
              {KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
            <label className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Add
              <input ref={fileInput} type="file" accept={ACCEPT} className="sr-only" onChange={e => onFile(e.target.files?.[0] ?? null)} disabled={busy} />
            </label>
          </div>
        )}
      </div>
      {err && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</p>}

      {/* The checklist — what this kind of bill needs, and where each one
          stands. Said on the card, so nobody finds out from a refused button. */}
      {checklist.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {checklist.map(r => {
            const tone = r.state === 'missing' ? 'bg-amber-50/70' : r.state === 'waived' ? 'bg-amber-50/30' : ''
            return (
              <li key={r.kind} className={`flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2 text-[13px] ${tone}`}>
                <span className="mt-0.5 shrink-0">
                  {r.state === 'attached' || r.state === 'in4'
                    ? <Check className="h-4 w-4 text-emerald-700" />
                    : r.state === 'waived'
                      ? <MessageSquareWarning className="h-4 w-4 text-amber-700" />
                      : <AlertTriangle className="h-4 w-4 text-amber-700" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <b className="text-gray-900">{r.label}</b>
                    {r.finalOnly && <span className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">final bill</span>}
                  </div>
                  <div className="text-[11.5px] text-gray-500">
                    {r.state === 'attached' && <>{r.docName ?? 'file'}{r.docBy ? ` · ${r.docBy}` : ''}{r.docOn ? ` · ${r.docOn}` : ''}</>}
                    {r.state === 'in4' && <>{r.note ?? 'read from IN4'}</>}
                    {r.state === 'waived' && (
                      <span className="text-amber-900">
                        <b>Not attached — </b>{r.reason}{r.waivedBy ? ` · ${r.waivedBy}` : ''}{r.waivedOn ? ` · ${r.waivedOn}` : ''}
                      </span>
                    )}
                    {r.state === 'missing' && <span className="font-medium text-amber-800">Not attached yet</span>}
                  </div>
                </div>
                {canAttach && r.state !== 'in4' && r.state !== 'attached' && (
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <button type="button" onClick={() => attachFor(r.kind)} disabled={busy}
                            className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
                      <Upload className="h-3 w-3" /> Attach
                    </button>
                    {canWaive && r.state === 'missing' && (
                      <button type="button" onClick={() => openReason(r)} disabled={busy}
                              className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-1 text-[12px] font-semibold text-amber-800 hover:bg-amber-50">
                        Not available — give reason
                      </button>
                    )}
                    {canWaive && r.state === 'waived' && (
                      <button type="button" onClick={() => withdraw(r)} disabled={busy} title="Withdraw the reason — the document is expected again"
                              className="inline-flex min-h-[32px] items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold text-gray-500 hover:text-gray-800">
                        <X className="h-3 w-3" /> Withdraw reason
                      </button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {canAttach && <p className="text-[11px] text-gray-400">Excel, PDF, images and Word — tap any to preview here, no download needed.</p>}

      {docs.length === 0 ? (
        checklist.length === 0 && <p className="text-sm text-gray-400">No documents attached yet.</p>
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
                  {d.kind ? (KINDS.find(k => k.key === d.kind)?.label ?? (d.kind === 'stamped_bill' ? 'Stamped bill' : d.kind)) + ' · ' : ''}{d.name || 'file'}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {view && <DocViewer doc={{ name: view.name, url: view.url, ext: view.ext }} onClose={() => setView(null)} />}

      <dialog ref={dlg} className="w-[min(520px,92vw)] rounded-2xl border border-gray-200 p-0 shadow-2xl backdrop:bg-gray-900/40">
        <div className="p-5">
          <h3 className="text-base font-bold text-gray-900">{ask?.label} — not available?</h3>
          <p className="mt-1 text-[13px] text-gray-600">
            Say why it cannot be attached. The CT Disc Head, the Project Head and the Atm Head are told your reason
            when you forward the bill, and it stays on the bill&apos;s record.
          </p>
          <label className="mt-3 block text-xs font-semibold text-gray-600">Reason <span className="text-rose-600">· required</span></label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} autoFocus
                    className="mt-1 w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    placeholder="e.g. Contractor has not submitted the marking plan; chased on 14 Oct" />
          {err && <p role="alert" className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => dlg.current?.close()}
                    className="min-h-[40px] rounded-lg border border-gray-300 px-3.5 py-2 text-sm font-semibold text-gray-700">Cancel</button>
            <button type="button" onClick={saveReason} disabled={busy || reason.trim().length < 8}
                    className="min-h-[40px] rounded-lg bg-amber-600 px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? 'Saving…' : 'Save reason'}
            </button>
          </div>
        </div>
      </dialog>
    </Card>
  )
}
