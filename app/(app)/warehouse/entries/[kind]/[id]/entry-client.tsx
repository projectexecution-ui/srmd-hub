'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { formatDate, formatDateTime } from '@/lib/utils'
import { formatQty } from '@/lib/warehouse/format'
import { voidGateEntry, recordReturn, attachGatePass } from '../../../admin-actions'
import { createClient } from '@/lib/supabase/client'
import { VOID_REASON_MIN } from '@/lib/warehouse/corrections'
import type { EntryDetail } from '@/lib/warehouse/admin-data'
import { Loader2, Undo2, PackageCheck, Info, ImageIcon } from 'lucide-react'

const inputCls =
  'w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm bg-white min-h-[40px] ' +
  'focus:outline-none focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400'
const labelCls = 'block text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1'

export function EntryClient({
  entry, mayVoid, mayReturn, whyNotVoid,
}: {
  entry: EntryDetail
  mayVoid: boolean
  mayReturn: boolean
  whyNotVoid: string | null
}) {
  return (
    <div className="space-y-3">
      {entry.voided && (
        <Card className="p-3 shadow-sm bg-rose-50 border-rose-200">
          <p className="text-[13px] font-bold text-rose-900 flex items-center gap-1.5">
            <Undo2 className="h-4 w-4" /> This entry was voided
          </p>
          <p className="text-[12.5px] text-rose-800 mt-1">
            {entry.voidReason || 'No reason was recorded.'}
            {entry.voidedBy ? ` — ${entry.voidedBy}` : ''}
          </p>
          <p className="text-[11.5px] text-rose-700 mt-1.5">
            Its quantities were reversed out of stock. The entry and its reversal both stay in the
            ledger, which is what makes the correction auditable rather than invisible.
          </p>
        </Card>
      )}

      <Card className="p-3 shadow-sm">
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">The entry</p>
          <p className="text-[11.5px] text-slate-500">
            {formatDate(entry.day)}{entry.createdByName ? ` · recorded by ${entry.createdByName}` : ''}
          </p>
        </div>
        <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
          {entry.facts.map(([label, value]) => (
            <div key={label} className="flex gap-2 text-[12.5px] min-w-0">
              <dt className="text-slate-500 flex-shrink-0 w-[104px]">{label}</dt>
              <dd className="font-semibold text-slate-800 min-w-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="p-0 shadow-sm overflow-hidden">
        <p className="px-3 pt-3 pb-2 text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
          {entry.lines.length} {entry.lines.length === 1 ? 'item' : 'items'}
        </p>
        <div className="divide-y divide-slate-100">
          {entry.lines.map(l => (
            <div key={l.lineId} className="px-3 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[13px] font-semibold text-slate-800 min-w-0">{l.itemName}</p>
                <p className="text-[13px] font-bold tabular-nums text-slate-900 whitespace-nowrap">
                  {formatQty(l.qty)} <span className="font-normal text-slate-400">{l.unit}</span>
                </p>
              </div>
              {(l.damaged ? l.damaged > 0 : false) || (l.short ? l.short > 0 : false) ? (
                <p className="text-[11.5px] mt-0.5">
                  {l.short ? <span className="text-rose-700 font-semibold mr-2">{formatQty(l.short)} short</span> : null}
                  {l.damaged ? <span className="text-amber-700 font-semibold">{formatQty(l.damaged)} damaged</span> : null}
                </p>
              ) : null}
              {entry.returnable && (
                <ReturnRow line={l} mayReturn={mayReturn} />
              )}
            </div>
          ))}
        </div>
      </Card>

      {entry.photoUrls.length > 0 && <BillPhotos urls={entry.photoUrls} />}

      {/* The signed pass, above the void panel: attaching it is the ordinary
          next step after a handover, voiding is the exception. */}
      {entry.kind === 'out' && !entry.voided && entry.destType !== 'store' && (
        <GatePassPanel entry={entry} />
      )}

      <VoidPanel entry={entry} mayVoid={mayVoid} whyNotVoid={whyNotVoid} />
    </div>
  )
}

// ---------------------------------------------------------------------------

/** Returnable material coming back. Partial is the normal case — half the
 *  shuttering comes back this week and the rest when the slab is struck. */
function ReturnRow({
  line, mayReturn,
}: {
  line: EntryDetail['lines'][number]
  mayReturn: boolean
}) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [open, setOpen] = useState(false)
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')

  const out = line.outstanding ?? 0
  const back = line.returned ?? 0

  if (out === 0) {
    return (
      <p className="text-[11.5px] text-emerald-700 font-semibold mt-1 flex items-center gap-1">
        <PackageCheck className="h-3.5 w-3.5" /> All {formatQty(line.qty)} {line.unit} is back
      </p>
    )
  }

  return (
    <div className="mt-1.5">
      <p className="text-[11.5px] text-amber-800 font-semibold">
        {formatQty(out)} {line.unit} still out
        {back > 0 ? ` · ${formatQty(back)} already returned` : ''}
      </p>

      {!open ? (
        <button type="button" onClick={() => setOpen(true)} disabled={!mayReturn}
          className="mt-1 rounded-lg border-2 border-slate-200 px-2.5 py-1.5 min-h-[44px] text-[12px] font-bold
                     text-slate-600 hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-50">
          Record a return
        </button>
      ) : (
        <div className="mt-1.5 rounded-xl border border-slate-200 bg-slate-50/70 p-2.5 space-y-2">
          <div className="grid grid-cols-[110px_1fr] gap-2">
            <div>
              <label className={labelCls} htmlFor={`q-${line.lineId}`}>How much</label>
              <input id={`q-${line.lineId}`} className={inputCls} inputMode="decimal" value={qty}
                onChange={e => setQty(e.target.value)} placeholder={String(out)} />
            </div>
            <div>
              <label className={labelCls} htmlFor={`n-${line.lineId}`}>Note (optional)</label>
              <input id={`n-${line.lineId}`} className={inputCls} value={note}
                onChange={e => setNote(e.target.value)} placeholder="Condition, who brought it back" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={busy}
              className="rounded-lg bg-emerald-600 px-3 py-2 min-h-[40px] text-[12.5px] font-bold text-white
                         hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-1.5"
              onClick={() => start(async () => {
                const n = Number(qty)
                if (!Number.isFinite(n) || n <= 0) { toast.error('Enter how much came back.'); return }
                const res = await recordReturn(line.lineId, n, note || null)
                if (!res.ok) { toast.error(res.error ?? 'Could not record that.'); return }
                toast.success(`${formatQty(n)} ${line.unit} back in stock`)
                setOpen(false); setQty(''); setNote('')
                router.refresh()
              })}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Back in stock
            </button>
            <button type="button" onClick={() => setOpen(false)} disabled={busy}
              className="rounded-lg border-2 border-slate-200 px-3 py-2 min-h-[40px] text-[12.5px] font-bold text-slate-500">
              Cancel
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            This puts the material back into {'the store it left'} and closes the line on the
            Returnables Outstanding report. More than went out is not a return — take that in at the gate.
          </p>
        </div>
      )}
    </div>
  )
}

function BillPhotos({ urls }: { urls: string[] }) {
  return (
    <Card className="p-3 shadow-sm">
      <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mb-2">
        The bill — {urls.length} {urls.length === 1 ? 'page' : 'pages'}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {urls.map((u, i) => (
          <a key={u} href={u} target="_blank" rel="noreferrer"
            className="rounded-xl border-2 border-slate-200 p-3 min-h-[64px] flex items-center gap-2
                       text-[12px] font-semibold text-slate-600 hover:border-emerald-300 hover:text-emerald-700">
            <ImageIcon className="h-4 w-4 flex-shrink-0" /> Page {i + 1}
          </a>
        ))}
      </div>
      <p className="text-[11px] text-slate-500 mt-2">
        It should carry the receiver’s signature and stamp, and the delivery person’s signature.
        Months later this photograph is the only independent record that the handover happened.
      </p>
    </Card>
  )
}

/** Voiding. Deliberately at the bottom, deliberately not a small icon: it
 *  reverses stock, and it should take a decision rather than a slip. */
function VoidPanel({
  entry, mayVoid, whyNotVoid,
}: {
  entry: EntryDetail
  mayVoid: boolean
  whyNotVoid: string | null
}) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')

  if (entry.voided) return null

  return (
    <Card className="p-3 shadow-sm border-slate-200">
      <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mb-1.5">
        Recorded wrong?
      </p>
      <p className="text-[12.5px] text-slate-600 mb-2">
        Voiding reverses everything this entry did to stock and stamps it with who and why.
        Nothing is deleted — the entry, the reason and the reversal all stay in the ledger.
        To correct it, void it and record it again the right way.
      </p>

      {/* The rule is shown rather than the button being quietly greyed out —
          a disabled control with no explanation is the same as no control. */}
      {whyNotVoid && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900
                        flex gap-2 items-start">
          <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          <span>{whyNotVoid}</span>
        </div>
      )}

      {mayVoid && !open && (
        <button type="button" onClick={() => setOpen(true)}
          className="rounded-lg border-2 border-rose-200 px-3 py-2 min-h-[40px] text-[12.5px] font-bold
                     text-rose-700 hover:bg-rose-50 inline-flex items-center gap-1.5">
          <Undo2 className="h-3.5 w-3.5" /> Void {entry.entryNo}
        </button>
      )}

      {mayVoid && open && (
        <div className="space-y-2">
          <div>
            <label className={labelCls} htmlFor="void-reason">Why is it being voided?</label>
            <input id="void-reason" className={inputCls} value={reason} autoFocus
              onChange={e => setReason(e.target.value)}
              placeholder="Wrong store — it went to Yunus, not NGH" />
            <p className="text-[11px] text-slate-500 mt-1">
              At least {VOID_REASON_MIN} characters. This is what the entry is judged by later —
              “wrong store” and “truck never came” are very different facts.
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={busy}
              className="rounded-lg bg-rose-600 px-3 py-2 min-h-[40px] text-[12.5px] font-bold text-white
                         hover:bg-rose-700 disabled:opacity-50 inline-flex items-center gap-1.5"
              onClick={() => start(async () => {
                const res = await voidGateEntry(entry.kind, entry.id, reason)
                if (!res.ok) { toast.error(res.error ?? 'Could not void it.', { duration: 9000 }); return }
                toast.success(`${entry.entryNo} voided and stock reversed`)
                setOpen(false)
                router.refresh()
              })}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Void and reverse the stock
            </button>
            <button type="button" onClick={() => { setOpen(false); setReason('') }} disabled={busy}
              className="rounded-lg border-2 border-slate-200 px-3 py-2 min-h-[40px] text-[12.5px] font-bold text-slate-500">
              Keep it
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}

/** The signed gate pass.
 *
 *  Aksha's rule: the physical pass, signed at the barrier, is what closes the
 *  engineer's request. Deliberately attached AFTER the entry — the pass is signed
 *  as the material changes hands, so demanding it before the entry could be saved
 *  would leave stock wrong for as long as the paperwork took.
 *
 *  Uploaded straight from the browser to storage, like the bill on Gate IN: a
 *  photograph over a site connection is not something to hold a server action
 *  open for. */
function GatePassPanel({ entry }: { entry: EntryDetail }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [uploading, setUploading] = useState(false)
  const attached = entry.gatePassUrls.length > 0

  async function pick(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    const supabase = createClient()
    const paths: string[] = []
    try {
      for (const [i, file] of Array.from(files).entries()) {
        const ext = file.type === 'application/pdf' ? 'pdf' : 'jpg'
        const path = `${entry.day}/${crypto.randomUUID()}-p${i + 1}.${ext}`
        const { error } = await supabase.storage.from('wh-gate-passes')
          .upload(path, file, { cacheControl: '3600', contentType: file.type || 'image/jpeg' })
        if (error) {
          toast.error(`Could not upload page ${i + 1}: ${error.message}`)
          setUploading(false)
          return
        }
        paths.push(path)
      }
    } catch (e) {
      setUploading(false)
      toast.error(e instanceof Error ? e.message : 'Could not upload the pass')
      return
    }
    setUploading(false)

    start(async () => {
      const res = await attachGatePass(entry.id, paths)
      if (!res.ok) { toast.error(res.error ?? 'Could not attach it.', { duration: 10000 }); return }
      toast.success('Signed gate pass attached')
      router.refresh()
    })
  }

  return (
    <Card className={`p-3 shadow-sm ${attached ? '' : 'bg-amber-50 border-amber-200'}`}>
      <p className={`text-[11px] font-extrabold uppercase tracking-wider mb-1.5 ${
        attached ? 'text-slate-400' : 'text-amber-800'}`}>
        Signed gate pass
      </p>

      {attached ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {entry.gatePassUrls.map((u, i) => (
              <a key={u} href={u} target="_blank" rel="noreferrer"
                className="rounded-xl border-2 border-slate-200 p-3 min-h-[64px] flex items-center gap-2
                           text-[12px] font-semibold text-slate-600 hover:border-emerald-300 hover:text-emerald-700">
                <ImageIcon className="h-4 w-4 flex-shrink-0" /> Page {i + 1}
              </a>
            ))}
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            Attached{entry.gatePassBy ? ` by ${entry.gatePassBy}` : ''}
            {entry.gatePassAt ? `, ${formatDateTime(entry.gatePassAt)}` : ''}.
            {entry.requestId ? ' The request it answers can now be closed.' : ''}
          </p>
        </>
      ) : (
        <p className="text-[12.5px] text-amber-900">
          <b>Not attached yet.</b> The material has gone out, but until the signed pass is
          photographed here
          {entry.requestId
            ? ' the request it answers stays open.'
            : ' this handover has no independent record.'}
        </p>
      )}

      <label className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border-2 border-slate-200 bg-white
                        px-3 py-2 min-h-[44px] text-[12.5px] font-bold text-slate-600 cursor-pointer
                        hover:border-emerald-300 hover:text-emerald-700 w-fit">
        {uploading || busy
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : <ImageIcon className="h-3.5 w-3.5" />}
        {attached ? 'Add another page' : 'Attach signed gate pass'}
        <input type="file" accept="image/*,application/pdf" multiple capture="environment"
          className="hidden" disabled={uploading || busy}
          onChange={e => { void pick(e.target.files); e.target.value = '' }} />
      </label>
    </Card>
  )
}
