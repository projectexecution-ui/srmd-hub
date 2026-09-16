'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { X, Wand2, Check, Copy, Loader2 } from 'lucide-react'
import { setDeskMember, saveProjectDesk, copyDesks } from '@/app/actions/bills-desk'

/** Who sits at which desk — one grid.
 *
 *  Aksha, 16 Sep 2026, screen C of the look-and-feel preview: "Build it". One
 *  person was on one desk. Every other desk was empty, the overview carried an
 *  amber banner, and a bill moved onto the Disc Head desk was held by nobody.
 *  This is the screen that changes that in an afternoon: rows are the IN4
 *  sub-projects that carry work orders, columns are the desks, a blank cell
 *  is a desk nobody holds.
 *
 *  SUGGEST fills the blanks from what is already known — the Atm Head from
 *  Cost Control's project approvers, the other desks from the default row —
 *  as dashed chips you accept or type over. Nothing is saved until you do.
 *  It never invents a name: where nothing is known the cell stays blank. */
export interface GridRow {
  subprojectId: number
  name: string
  projectCode: string | null
  wos: number
  /** desk key → user ids seated at this sub-project's own desk. */
  members: Record<string, string[]>
  atmHeadId: string | null
  /** Cost Control heads on the linked project — the Atm fallback, and the suggestion. */
  ccHeads: string[]
}
type Person = { id: string; name: string }
type Desk = { key: string; label: string }

export function DeskGrid({ rows, global, people, desks }: {
  rows: GridRow[]
  /** desk key → user ids on the default (all projects) row. */
  global: Record<string, string[]>
  people: Person[]
  desks: Desk[]
}) {
  const router = useRouter()
  const supabase = createClient()
  const [busy, start] = useTransition()
  const [g, setG] = useState(global)
  const [r, setR] = useState(rows)
  const [suggest, setSuggest] = useState(false)
  const nameOf = (id: string) => people.find(p => p.id === id)?.name ?? 'Unknown'

  /* ── default row: straight to the RPC, project null ── */
  async function globalAdd(desk: string, user: string) {
    const { error } = await supabase.rpc('bb_rpc_add_desk_member', { p_desk: desk, p_project: null, p_user: user })
    if (error) { toast.error(error.message); return }
    setG(s => ({ ...s, [desk]: [...new Set([...(s[desk] ?? []), user])] }))
  }
  async function globalRemove(desk: string, user: string) {
    const { error } = await supabase.rpc('bb_rpc_remove_desk_member', { p_desk: desk, p_project: null, p_user: user })
    if (error) { toast.error(error.message); return }
    setG(s => ({ ...s, [desk]: (s[desk] ?? []).filter(u => u !== user) }))
  }

  /* ── a sub-project's own desk ── */
  function seat(sid: number, desk: string, user: string, on: boolean) {
    start(async () => {
      const res = await setDeskMember({ subprojectId: sid, desk, userId: user, on })
      if (!res.ok) { toast.error(res.error ?? 'Could not change the desk'); return }
      setR(rows => rows.map(row => row.subprojectId !== sid ? row : {
        ...row,
        members: { ...row.members, [desk]: on ? [...new Set([...(row.members[desk] ?? []), user])] : (row.members[desk] ?? []).filter(u => u !== user) },
      }))
    })
  }
  function setAtm(sid: number, user: string | null) {
    start(async () => {
      const res = await saveProjectDesk({ subprojectId: sid, atmHeadId: user })
      if (!res.ok) { toast.error(res.error ?? 'Could not set the Atm Head'); return }
      setR(rows => rows.map(row => row.subprojectId !== sid ? row : { ...row, atmHeadId: user }))
    })
  }

  /* ── suggestions ── */
  const suggestionFor = (row: GridRow, desk: string): string[] =>
    (row.members[desk]?.length ? [] : (g[desk] ?? []))
  const atmSuggestion = (row: GridRow): string | null =>
    row.atmHeadId ? null : (row.ccHeads[0] ?? null)
  const suggestionCount = r.reduce((n, row) =>
    n + desks.reduce((m, d) => m + suggestionFor(row, d.key).length, 0) + (atmSuggestion(row) ? 1 : 0), 0)

  function acceptAll() {
    start(async () => {
      let done = 0
      for (const row of r) {
        for (const d of desks) for (const u of suggestionFor(row, d.key)) {
          const res = await setDeskMember({ subprojectId: row.subprojectId, desk: d.key, userId: u, on: true })
          if (res.ok) done++
        }
        const a = atmSuggestion(row)
        if (a) { const res = await saveProjectDesk({ subprojectId: row.subprojectId, atmHeadId: a }); if (res.ok) done++ }
      }
      toast.success(`${done} ${done === 1 ? 'seat' : 'seats'} filled`)
      setSuggest(false)
      router.refresh()
    })
  }

  function copyRowToEmpty(from: GridRow) {
    start(async () => {
      const targets = r.filter(row => row.subprojectId !== from.subprojectId && desks.every(d => !(row.members[d.key]?.length)))
      let n = 0
      for (const t of targets) {
        const res = await copyDesks({ toSubprojectId: t.subprojectId, fromSubprojectId: from.subprojectId })
        if (res.ok) n++
      }
      toast.success(`Copied ${from.name}'s desks onto ${n} ${n === 1 ? 'row' : 'rows'} that had none`)
      router.refresh()
    })
  }

  const chip = 'inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-[12px] text-gray-800'
  const ghost = 'inline-flex items-center gap-1 rounded-md border border-dashed border-indigo-400 bg-indigo-50 px-2 py-1 text-[12px] text-indigo-900'
  const empty = 'inline-block rounded-md border border-dashed border-amber-400 bg-amber-50 px-2 py-1 text-[12px] text-amber-800'

  const AddPick = ({ onPick, exclude }: { onPick: (u: string) => void; exclude: string[] }) => (
    <select defaultValue="" onChange={e => { if (e.target.value) { onPick(e.target.value); e.target.value = '' } }}
            aria-label="Add a person" className="h-7 max-w-[28px] rounded-md border border-gray-300 bg-white text-[11px] text-gray-500 hover:max-w-none">
      <option value="">+</option>
      {people.filter(p => !exclude.includes(p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setSuggest(v => !v)} disabled={busy}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
          <Wand2 className="h-4 w-4" /> {suggest ? 'Hide suggestions' : 'Suggest from Cost Control & the default row'}
        </button>
        {suggest && suggestionCount > 0 && (
          <button type="button" onClick={acceptAll} disabled={busy}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-indigo-300 bg-white px-3.5 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Accept all {suggestionCount}
          </button>
        )}
        {suggest && suggestionCount === 0 && <span className="text-[12px] text-gray-500">Nothing to suggest — set the default row first, or a Cost Control head on the project.</span>}
      </div>

      {suggest && (
        <p className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-[13px] text-indigo-900">
          <b>Suggestions shown as dashed chips — nothing saved yet.</b> The Atm Head comes from Cost Control&apos;s project
          approvers; the other desks from the default row. Accept all, or tick them one at a time.
        </p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-[13px]" style={{ minWidth: 980 }}>
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2.5">Sub-project</th>
              {desks.map(d => <th key={d.key} className="px-3 py-2.5">{d.label}</th>)}
              <th className="px-3 py-2.5">Atm Head</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {/* the default row */}
            <tr className="bg-indigo-50/30">
              <td className="px-3 py-2.5 font-semibold text-gray-900">Default — every sub-project<span className="block text-[10.5px] font-normal text-gray-500">used where a row below is blank</span></td>
              {desks.map(d => (
                <td key={d.key} className="px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-1">
                    {(g[d.key] ?? []).map(u => (
                      <span key={u} className={chip}>{nameOf(u)}
                        <button type="button" onClick={() => globalRemove(d.key, u)} aria-label={`Remove ${nameOf(u)}`} className="rounded-full p-0.5 hover:bg-gray-300"><X className="h-3 w-3" /></button>
                      </span>
                    ))}
                    <AddPick onPick={u => globalAdd(d.key, u)} exclude={g[d.key] ?? []} />
                  </div>
                </td>
              ))}
              <td className="px-3 py-2.5 text-[11px] text-gray-400">per project, from Cost Control</td>
              <td />
            </tr>

            {r.map(row => (
              <tr key={row.subprojectId}>
                <td className="px-3 py-2.5 font-semibold text-gray-900">
                  {row.name}
                  <span className="block text-[10.5px] font-normal text-gray-400">
                    {row.projectCode ? `${row.projectCode} · ` : ''}{row.wos} {row.wos === 1 ? 'work order' : 'work orders'}
                  </span>
                </td>
                {desks.map(d => {
                  const mine = row.members[d.key] ?? []
                  const sugg = suggest ? suggestionFor(row, d.key) : []
                  return (
                    <td key={d.key} className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-1">
                        {mine.map(u => (
                          <span key={u} className={chip}>{nameOf(u)}
                            <button type="button" onClick={() => seat(row.subprojectId, d.key, u, false)} aria-label={`Remove ${nameOf(u)}`} className="rounded-full p-0.5 hover:bg-gray-300"><X className="h-3 w-3" /></button>
                          </span>
                        ))}
                        {sugg.map(u => (
                          <button key={u} type="button" onClick={() => seat(row.subprojectId, d.key, u, true)} className={ghost} title="Suggested from the default row — click to seat">
                            <Check className="h-3 w-3" /> {nameOf(u)}
                          </button>
                        ))}
                        {mine.length === 0 && sugg.length === 0 && (
                          (g[d.key]?.length ?? 0) > 0
                            ? <span className="text-[11px] text-gray-400" title="Falls back to the default row">default</span>
                            : <span className={empty}>Nobody</span>
                        )}
                        <AddPick onPick={u => seat(row.subprojectId, d.key, u, true)} exclude={mine} />
                      </div>
                    </td>
                  )
                })}
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-1">
                    {row.atmHeadId ? (
                      <span className={chip}>{nameOf(row.atmHeadId)}
                        <button type="button" onClick={() => setAtm(row.subprojectId, null)} aria-label="Remove Atm Head" className="rounded-full p-0.5 hover:bg-gray-300"><X className="h-3 w-3" /></button>
                      </span>
                    ) : suggest && atmSuggestion(row) ? (
                      <button type="button" onClick={() => setAtm(row.subprojectId, atmSuggestion(row))} className={ghost} title="From Cost Control — click to seat">
                        <Check className="h-3 w-3" /> {nameOf(atmSuggestion(row)!)}
                      </button>
                    ) : row.ccHeads.length ? (
                      <span className="text-[11px] text-gray-500" title="Resolved from Cost Control's project approvers">via Cost Control: {row.ccHeads.map(nameOf).join(', ')}</span>
                    ) : (
                      <span className={empty}>Nobody</span>
                    )}
                    <AddPick onPick={u => setAtm(row.subprojectId, u)} exclude={row.atmHeadId ? [row.atmHeadId] : []} />
                  </div>
                </td>
                <td className="px-2 py-2.5">
                  {desks.some(d => row.members[d.key]?.length) && (
                    <button type="button" onClick={() => copyRowToEmpty(row)} disabled={busy} title="Copy this row's desks onto every row that has none"
                            className="inline-flex min-h-[32px] items-center gap-1 rounded-md px-2 text-[11px] font-semibold text-gray-500 hover:bg-gray-100 hover:text-gray-800">
                      <Copy className="h-3 w-3" /> to empty rows
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-gray-500">
        Membership is per <b>sub-project</b>, and the move gate reads the same key the notifier uses — so the person told
        about a bill is always a person who can act on it. A blank cell falls back to the default row; a blank default is a
        desk nobody holds.
      </p>
    </div>
  )
}
