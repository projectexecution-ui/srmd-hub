'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Check, Copy, Loader2, Plus, X } from 'lucide-react'
import { saveProjectDesk, setDeskMember, copyDesks } from '@/app/actions/bills-desk'

type Person = { id: string; name: string }
type Opt = { id: string; code: string; name: string }

const SEL = 'h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm mt-1'

/** Everything about one Bills Approval project, on one screen.
 *
 *  Aksha's rule is that a task's steps belong together — where it books, who
 *  approves it, and who works each desk are one decision made in one sitting,
 *  not three screens. So the desks live here rather than back on the org-level
 *  Bills desks page, which can only key on a CT Hub project anyway and is
 *  exactly why these sub-projects had no desks at all.
 */
export function ProjectDeskEditor(props: {
  subprojectId: number
  in4Name: string
  shortName: string
  ccProjectId: string
  in4Linked: { id: string; name: string } | null
  atmHeadId: string
  note: string
  desks: Array<{ key: string; label: string }>
  seat: Record<string, string[]>
  people: Person[]
  projects: Opt[]
  copyFrom: Array<{ subprojectId: number; label: string }>
}) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  const [shortName, setShortName] = useState(props.shortName)
  const [ccProjectId, setCcProjectId] = useState(props.ccProjectId)
  const [atmHeadId, setAtmHeadId] = useState(props.atmHeadId)
  const [note, setNote] = useState(props.note)
  const [seat, setSeat] = useState(props.seat)
  const [copySrc, setCopySrc] = useState('')

  const nameOf = (id: string) => props.people.find(p => p.id === id)?.name ?? 'Unknown'

  function saveHeader() {
    setErr(null)
    start(async () => {
      const r = await saveProjectDesk({
        subprojectId: props.subprojectId,
        ccProjectId: props.in4Linked ? props.in4Linked.id : (ccProjectId || null),
        atmHeadId: atmHeadId || null,
        shortName: shortName.trim() || null,
        note: note.trim() || null,
      })
      if (!r.ok) { setErr(r.error ?? 'Could not save.'); return }
      toast.success('Saved. Every bill on this sub-project books here from now on.')
      router.refresh()
    })
  }

  function toggleSeat(deskKey: string, userId: string, on: boolean) {
    setErr(null)
    // Optimistic, then reconciled by the refresh — a desk list that lags a
    // click by a round trip feels broken on a page where you set six of them.
    setSeat(s => ({
      ...s,
      [deskKey]: on ? [...(s[deskKey] ?? []), userId] : (s[deskKey] ?? []).filter(u => u !== userId),
    }))
    start(async () => {
      const r = await setDeskMember({ subprojectId: props.subprojectId, desk: deskKey, userId, on })
      if (!r.ok) {
        setErr(r.error ?? 'Could not change the desk.')
        setSeat(s => ({
          ...s,
          [deskKey]: on ? (s[deskKey] ?? []).filter(u => u !== userId) : [...(s[deskKey] ?? []), userId],
        }))
        return
      }
      router.refresh()
    })
  }

  function runCopy() {
    if (!copySrc) return
    setErr(null)
    start(async () => {
      const r = await copyDesks({ toSubprojectId: props.subprojectId, fromSubprojectId: Number(copySrc) })
      if (!r.ok) { setErr(r.error ?? 'Could not copy.'); return }
      toast.success(`Copied ${r.count ?? 0} desk ${r.count === 1 ? 'seat' : 'seats'} across.`)
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      {err && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}

      {/* 1 — where it books and who signs */}
      <Card className="space-y-4 p-4">
        <h2 className="text-sm font-semibold text-gray-900">Where it books</h2>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="sn">Call it</Label>
            <Input id="sn" value={shortName} onChange={e => setShortName(e.target.value)} placeholder={props.in4Name} />
            <p className="mt-1 text-[11px] text-gray-500">Optional. IN4 calls it &ldquo;{props.in4Name}&rdquo;.</p>
          </div>
          <div>
            <Label htmlFor="cc">CT Hub project</Label>
            {props.in4Linked ? (
              <>
                <div className={`${SEL} flex items-center bg-gray-50 text-gray-600`}>{props.in4Linked.name}</div>
                <p className="mt-1 text-[11px] text-gray-500">IN4 maps this one, so it is not set here.</p>
              </>
            ) : (
              <>
                <select id="cc" value={ccProjectId} onChange={e => setCcProjectId(e.target.value)} className={SEL}>
                  <option value="">— none, this building is not in CT Hub —</option>
                  {props.projects.map(p => <option key={p.id} value={p.id}>{p.code ? `${p.code} — ` : ''}{p.name}</option>)}
                </select>
                <p className="mt-1 text-[11px] text-gray-500">Leave it empty. Set it later if a project is created.</p>
              </>
            )}
          </div>
          <div>
            <Label htmlFor="atm">Atm Head</Label>
            <select id="atm" value={atmHeadId} onChange={e => setAtmHeadId(e.target.value)} className={SEL}>
              <option value="">— nobody yet —</option>
              {props.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-gray-500">Who sanctions bills here. This is the one that routes the Atm desk.</p>
          </div>
          <div>
            <Label htmlFor="nt">Note</Label>
            <Input id="nt" value={note} onChange={e => setNote(e.target.value)} placeholder="why it is set this way, if it needs saying" />
          </div>
        </div>

        <Button onClick={saveHeader} disabled={busy} className="bg-indigo-600 hover:bg-indigo-700">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
        </Button>
      </Card>

      {/* 2 — the desks. Every one, because this is the whole flow for a
          building CT Hub has no project for. */}
      <Card className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Who works each desk</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              Any member of a desk can act. Leave one empty and it falls back to the default team on{' '}
              <span className="font-medium">Bills desks</span>.
            </p>
          </div>

          {props.copyFrom.length > 0 && (
            <div className="flex items-end gap-2">
              <div>
                <Label htmlFor="cp" className="text-[11px]">Copy desks from</Label>
                <select id="cp" value={copySrc} onChange={e => setCopySrc(e.target.value)}
                        className="mt-1 h-9 rounded-lg border border-gray-300 bg-white px-2 text-xs">
                  <option value="">— pick one —</option>
                  {props.copyFrom.map(c => <option key={c.subprojectId} value={c.subprojectId}>{c.label}</option>)}
                </select>
              </div>
              <button type="button" onClick={runCopy} disabled={busy || !copySrc}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                <Copy className="h-3.5 w-3.5" /> Copy
              </button>
            </div>
          )}
        </div>

        {copySrc && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
            Copying <b>replaces</b> every desk here with that project&apos;s, and brings its Atm Head across.
            It does not merge the two.
          </p>
        )}

        <div className="space-y-3">
          {props.desks.map(d => (
            <DeskRow key={d.key} desk={d} members={seat[d.key] ?? []} people={props.people}
                     nameOf={nameOf} busy={busy}
                     onToggle={(uid, on) => toggleSeat(d.key, uid, on)} />
          ))}
        </div>
      </Card>
    </div>
  )
}

function DeskRow({ desk, members, people, nameOf, busy, onToggle }: {
  desk: { key: string; label: string }
  members: string[]
  people: Person[]
  nameOf: (id: string) => string
  busy: boolean
  onToggle: (userId: string, on: boolean) => void
}) {
  const [adding, setAdding] = useState(false)
  const free = people.filter(p => !members.includes(p.id))

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-gray-800">{desk.label}</span>
        {!adding && free.length > 0 && (
          <button type="button" onClick={() => setAdding(true)} disabled={busy}
                  className="inline-flex min-h-[32px] items-center gap-1 text-xs font-semibold text-indigo-700 hover:text-indigo-900 disabled:opacity-50">
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {members.length === 0 && !adding && (
          <span className="text-xs text-gray-500">Nobody — falls back to the default team.</span>
        )}
        {members.map(uid => (
          <span key={uid} className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 py-1 pl-2.5 pr-1 text-xs font-medium text-indigo-800">
            {nameOf(uid)}
            <button type="button" onClick={() => onToggle(uid, false)} disabled={busy}
                    aria-label={`Remove ${nameOf(uid)} from ${desk.label}`}
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-indigo-100 disabled:opacity-50">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>

      {adding && (
        <div className="mt-2 flex items-center gap-2">
          <select defaultValue="" disabled={busy}
                  onChange={e => { if (e.target.value) { onToggle(e.target.value, true); setAdding(false) } }}
                  className="h-9 flex-1 rounded-lg border border-gray-300 bg-white px-2 text-sm">
            <option value="">— pick somebody —</option>
            {free.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button type="button" onClick={() => setAdding(false)}
                  className="min-h-[36px] text-xs font-semibold text-gray-600 hover:text-gray-900">Cancel</button>
        </div>
      )}
    </div>
  )
}
