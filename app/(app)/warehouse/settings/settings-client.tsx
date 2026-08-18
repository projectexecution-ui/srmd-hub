'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { saveSetting, addListValue, setListValueActive } from '../actions'
import { StoreMap } from './store-map'
import {
  SETTINGS, SECTIONS, NOT_BUILT,
  isOn, rawValue, valuesHiddenRoles,
} from '@/lib/warehouse/settings'
import type { SettingDef, SettingValues, HideableRole } from '@/lib/warehouse/settings'
import type { AdminLocation } from '@/lib/warehouse/admin-data'
import { formatDateTime } from '@/lib/utils'
import { ChevronRight, Loader2, Lock, ShieldCheck, Plus, X, Info, EyeOff } from 'lucide-react'

const inputCls =
  'w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm bg-white min-h-[40px] ' +
  'focus:outline-none focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400'

type ListRow = { id: string; kind: string; value: string; is_active: boolean; sort: number }
type HistoryRow = {
  id: string; key: string; old_value: string | null; new_value: string | null
  changed_at: string; profiles: { full_name: string | null; email: string | null } | Array<{ full_name: string | null; email: string | null }> | null
}

const LIST_META: Record<string, { label: string; what: string }> = {
  category:      { label: 'Item categories', what: 'Groups items so a report reads “Cement”, not forty separate names' },
  unit:          { label: 'Units', what: 'Bag, MT, Nos, Brass — locked to each item, so stock can never mix bags with tonnes' },
  delivery_mode: { label: 'Delivery modes', what: 'How it reached us — truck, tempo, tractor, by hand' },
  entity:        { label: 'Who paid (entity)', what: 'SRMD Org Stock, SRASSK, SRET, SRJT, SRST' },
  count_reason:  { label: 'Count difference reasons', what: 'Why a count does not tally — wastage, breakage, not traced' },
  discipline:    { label: 'IN4 budget heads', what: 'IN4’s cost codes, kept for provenance only — nothing groups or reports by these. Material families are the categories above' },
}

const HUB_SCREENS: Array<[string, string, string]> = [
  ['/admin/users', 'Admin ▸ Users', 'Who exists, who is active, who has left — one list for every module'],
  ['/admin/permissions', 'Admin ▸ Permissions', 'The role × module matrix. Warehouse is one row in it'],
  ['/settings/notifications', 'Settings ▸ Notifications', 'Which alerts go out, to whom, on email or Telegram — plus each person’s own mute'],
  ['/admin/recycle-bin', 'Admin ▸ Recycle bin', 'A deleted entry can be restored instead of being lost'],
  ['/admin/approvals', 'Admin ▸ Approvals', 'The approval chain a count rides on'],
]

export function SettingsClient({
  values, sites, people, lists, history, itemsPerStore, itemCount, hideableRoles, canAdmin,
}: {
  values: SettingValues
  hideableRoles: HideableRole[]
  sites: AdminLocation[]
  people: Array<{ id: string; name: string }>
  lists: ListRow[]
  history: HistoryRow[]
  itemsPerStore: Record<string, number>
  itemCount: number
  canAdmin: boolean
}) {
  const [open, setOpen] = useState<string | null>(null)

  const bySection = (key: string) => SETTINGS.filter(s => s.section === key)

  return (
    <div className="space-y-3">
      <p className="text-[11.5px] text-slate-500 px-0.5">
        Four sections, closed until you need them. Each switch shows what is happening
        <b> right now</b> — press “What if I change it?” for the other side.
        <span className="ml-1.5 inline-flex items-center gap-1 text-emerald-700 font-semibold">
          <ShieldCheck className="h-3 w-3" /> Recommended
        </span>{' '}
        means leave it alone unless you have a reason.
      </p>

      {SECTIONS.map(sec => {
        const live = bySection(sec.key)
        const isOpenNow = open === sec.key
        // The header says the STATE, not the size: "6 of 9 on" answers the
        // question you opened the section to ask.
        const count = sec.key === 'lists' ? `${Object.keys(LIST_META).length} lists`
          : sec.key === 'who-where' ? `${sites.filter(s => s.active).length} sites · ${sites.flatMap(s => s.children).filter(c => c.active).length} stores`
          : sec.key === 'elsewhere' ? `${HUB_SCREENS.length} screens`
          : `${live.filter(d => d.kind === 'toggle' && isOn(values, d.key)).length} of ${live.filter(d => d.kind === 'toggle').length} on`

        return (
          <Card key={sec.key} className="p-0 shadow-sm overflow-hidden">
            <button type="button" onClick={() => setOpen(isOpenNow ? null : sec.key)}
              aria-expanded={isOpenNow}
              className="w-full px-4 py-3 min-h-[56px] flex items-center gap-3 text-left hover:bg-slate-50">
              <span className="text-base leading-none">{sec.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-bold text-slate-800">{sec.title}</span>
                <span className="block text-[11.5px] text-slate-500 mt-0.5">{sec.subtitle}</span>
              </span>
              <span className="text-[10.5px] font-bold text-slate-400 whitespace-nowrap">{count}</span>
              <ChevronRight className={`h-4 w-4 text-slate-400 flex-shrink-0 transition ${isOpenNow ? 'rotate-90' : ''}`} />
            </button>

            {isOpenNow && (
              <div className="border-t border-slate-100 p-4 space-y-3">
                {live.map(def => (
                  <SettingRow key={def.key} def={def} values={values}
                    hideableRoles={hideableRoles} canAdmin={canAdmin} />
                ))}

                {sec.key === 'who-where' && (
                  <StoreMap sites={sites} people={people} itemsPerStore={itemsPerStore} canAdmin={canAdmin} />
                )}
                {sec.key === 'lists' && <Lists lists={lists} itemCount={itemCount} canAdmin={canAdmin} />}
                {sec.key === 'elsewhere' && <><SyncLink /><RolesTable /><FromHub /></>}
              </div>
            )}
          </Card>
        )
      })}

      <NotBuilt />
      <History history={history} />
    </div>
  )
}

// ---------------------------------------------------------------------------

function SettingRow({ def, values, hideableRoles, canAdmin }: {
  def: SettingDef; values: SettingValues; hideableRoles: HideableRole[]; canAdmin: boolean
}) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const on = isOn(values, def.key)
  const raw = rawValue(values, def.key)
  const [why, setWhy] = useState(false)

  function save(value: string) {
    start(async () => {
      const res = await saveSetting(def.key, value)
      if (!res.ok) { toast.error(res.error ?? 'Could not save that.'); return }
      toast.success('Saved')
      router.refresh()
    })
  }

  return (
    <div className="rounded-xl border border-slate-200 p-2.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-slate-800 flex items-center gap-1.5 flex-wrap">
            {def.label}
            {def.recommended && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-extrabold uppercase text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5">
                <ShieldCheck className="h-2.5 w-2.5" /> recommended
              </span>
            )}
          </p>
          {/* One line, describing the state you are ACTUALLY in. Showing both
              the on and the off paragraph for all nine settings was the wall of
              reading Aksha objected to — and the off case is the hypothetical,
              which is exactly the half you do not need while scanning. */}
          <p className="text-[11.5px] text-slate-600 mt-0.5 leading-snug">
            {def.kind === 'toggle'
              ? (on ? def.onEffect : def.offEffect)
              : raw ? def.onEffect : def.offEffect}
          </p>

          {why && (
            <div className="mt-1.5 rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-2 space-y-1">
              <p className="text-[11.5px] text-slate-600 leading-snug">
                <b className="text-slate-800">{def.kind === 'toggle' ? 'Turned off:' : 'Not set:'}</b>{' '}
                {def.kind === 'toggle' ? (on ? def.offEffect : def.onEffect) : def.onEffect}
              </p>
              <p className="text-[10.5px] text-slate-400">Applied: {def.enforcedAt}</p>
            </div>
          )}
          <button type="button" onClick={() => setWhy(v => !v)}
            className="mt-1 text-[10.5px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-600">
            {why ? 'Less' : 'What if I change it?'}
          </button>
        </div>

        {def.kind === 'toggle' && (
          <button type="button" role="switch" aria-checked={on} aria-label={def.label}
            disabled={!canAdmin || busy}
            onClick={() => save(on ? 'false' : 'true')}
            className={`relative flex-shrink-0 w-[52px] h-[30px] rounded-full transition disabled:opacity-50 ${
              on ? 'bg-emerald-600' : 'bg-slate-300'}`}>
            <span className={`absolute top-[3px] h-6 w-6 rounded-full bg-white shadow transition-all ${
              on ? 'left-[25px]' : 'left-[3px]'}`} />
          </button>
        )}
      </div>

      {def.kind === 'date' && (
        <div className="mt-2 flex items-end gap-2">
          <div className="flex-1 max-w-[220px]">
            <input type="date" className={inputCls} defaultValue={raw} disabled={!canAdmin || busy}
              onChange={e => save(e.target.value)} aria-label={def.label} />
          </div>
          {raw && canAdmin && (
            <button type="button" onClick={() => save('')} disabled={busy}
              className="text-[11.5px] font-semibold text-slate-500 hover:text-rose-600 min-h-[40px]">
              Clear
            </button>
          )}
          {raw && <Lock className="h-3.5 w-3.5 text-slate-400 mb-3" />}
        </div>
      )}

      {def.kind === 'roles' && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {hideableRoles.map(r => {
              const hidden = valuesHiddenRoles(values).includes(r.id)
              return (
                <button key={r.id} type="button" aria-pressed={hidden} disabled={!canAdmin || busy}
                  aria-label={`${hidden ? 'Show' : 'Hide'} rates and values for ${r.label}`}
                  onClick={() => {
                    const next = hidden
                      ? valuesHiddenRoles(values).filter(x => x !== r.id)
                      : [...valuesHiddenRoles(values), r.id]
                    save(next.join(','))
                  }}
                  className={`rounded-full border-2 px-3 py-1.5 min-h-[38px] text-[12px] font-bold transition
                              disabled:opacity-50 inline-flex items-center gap-1.5 ${
                    hidden ? 'border-slate-700 bg-slate-700 text-white'
                           : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'}`}>
                  {hidden && <EyeOff className="h-3 w-3" />}
                  {r.label}
                  {/* The people count is the point: it turns "hide from Viewer"
                      into "hide from 27 people", which is the actual decision. */}
                  <span className={hidden ? 'text-slate-300 font-normal' : 'text-slate-400 font-normal'}>
                    {r.people}
                  </span>
                </button>
              )
            })}
          </div>

          {/* A role with no warehouse access cannot be shown a rate in the first
              place. Saying so stops a tapped chip from looking like protection
              it is not providing — which is exactly how this drifted before. */}
          {hideableRoles.some(r => valuesHiddenRoles(values).includes(r.id) && !r.hasAccess) && (
            <p className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
              {hideableRoles.filter(r => valuesHiddenRoles(values).includes(r.id) && !r.hasAccess)
                .map(r => r.label).join(', ')} cannot open the warehouse at all, so hiding values
              from them changes nothing. Harmless, but it is not protection.
            </p>
          )}

          <p className="text-[11px] text-slate-500">
            Tapped roles see quantities only — no rate, no ₹, and no value column anywhere,
            including the Excel and PDF exports. The number on each chip is how many people hold
            that role today. <b>An admin always sees values</b>, which is why Admin is not offered.
          </p>
        </div>
      )}

      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400 mt-2" />}
    </div>
  )
}

function RolesTable() {
  const rows: Array<[string, string, string, string]> = [
    ['Security guard', 'edit · values hidden', 'Record material arriving and leaving at the gate', 'See any rate, value or money report'],
    ['Storekeeper', 'edit', 'All gate entries · move stock between stores · count stock', 'Approve his own count'],
    ['Site engineer', 'edit', 'Receive material at site · see stock', 'Approve a count'],
    ['Atm Head', 'admin', 'Approve counts · these settings · every report', 'Change a locked month'],
    ['Trustee / Management', 'view', 'Every report, every site, all values', 'Make or change entries'],
    ['Admin', 'admin', 'Everything, including users and permissions', '—'],
  ]
  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-700 flex items-start gap-2">
        <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-slate-400" />
        <span>
          <b>Read-only here.</b> Roles belong to the whole hub, not to this module — they live in one place,{' '}
          <Link href="/admin/permissions" className="font-semibold text-emerald-700 hover:underline">Admin ▸ Permissions</Link>,
          where Warehouse is simply one row. Two places to set the same thing is how they drift apart.
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-[12px]">
          <thead>
            <tr className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 border-b border-slate-100">
              <th className="text-left px-2 py-1.5">Person</th>
              <th className="text-left px-2 py-1.5">Level</th>
              <th className="text-left px-2 py-1.5">Can do</th>
              <th className="text-left px-2 py-1.5">Cannot do</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([who, level, can_, cannot]) => (
              <tr key={who} className="border-b border-slate-50 last:border-0">
                <td className="px-2 py-1.5 font-semibold text-slate-800">{who}</td>
                <td className="px-2 py-1.5 font-mono text-[11px] text-slate-500">{level}</td>
                <td className="px-2 py-1.5 text-slate-600">{can_}</td>
                <td className="px-2 py-1.5 text-rose-700">{cannot}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Lists({ lists, itemCount, canAdmin }: { lists: ListRow[]; itemCount: number; canAdmin: boolean }) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const [adding, setAdding] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const kinds = Object.keys(LIST_META)

  return (
    <div className="space-y-3">
      <p className="text-[11.5px] text-slate-500">
        You change a name here and it changes everywhere — no code and no waiting. A value is switched off rather
        than deleted, so entries already recorded against it keep reading correctly.
      </p>

      {kinds.map(kind => {
        const rows = lists.filter(l => l.kind === kind)
        const meta = LIST_META[kind]
        return (
          <div key={kind} className="rounded-xl border border-slate-200 p-3">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-[12.5px] font-bold text-slate-800">{meta.label}</span>
              <span className="text-[11px] text-slate-400">{rows.filter(r => r.is_active).length} in use</span>
            </div>
            <p className="text-[11.5px] text-slate-500 mt-0.5 leading-snug">{meta.what}</p>

            <div className="flex flex-wrap gap-1.5 mt-2">
              {rows.map(r => (
                <span key={r.id}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] ${
                    r.is_active
                      ? 'border-slate-200 bg-white text-slate-700'
                      : 'border-slate-200 bg-slate-100 text-slate-400 line-through'}`}>
                  {r.value}
                  {canAdmin && (
                    <button type="button" disabled={busy}
                      aria-label={r.is_active ? `Switch off ${r.value}` : `Switch on ${r.value}`}
                      onClick={() => start(async () => {
                        const res = await setListValueActive(r.id, !r.is_active)
                        if (!res.ok) { toast.error(res.error ?? 'Could not change that.'); return }
                        router.refresh()
                      })}
                      className="text-slate-400 hover:text-rose-600 min-h-[20px]">
                      {r.is_active ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                    </button>
                  )}
                </span>
              ))}
              {rows.length === 0 && (
                <span className="text-[11.5px] text-slate-400">
                  {kind === 'discipline'
                    ? 'Comes from the item master — nothing to fill in by hand.'
                    : 'Nothing on this list yet.'}
                </span>
              )}
            </div>

            {canAdmin && kind !== 'discipline' && (
              adding === kind ? (
                <div className="mt-2 flex gap-2">
                  <input className={inputCls} value={draft} autoFocus placeholder="New value"
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Escape') { setAdding(null); setDraft('') } }} />
                  <button type="button" disabled={busy || !draft.trim()}
                    onClick={() => start(async () => {
                      const res = await addListValue(kind, draft)
                      if (!res.ok) { toast.error(res.error ?? 'Could not add that.'); return }
                      toast.success(`Added ${draft.trim()}`)
                      setDraft(''); setAdding(null); router.refresh()
                    })}
                    className="rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-2 min-h-[40px] text-[12px] font-bold text-white disabled:opacity-50">
                    Add
                  </button>
                  <button type="button" onClick={() => { setAdding(null); setDraft('') }}
                    className="rounded-lg border-2 border-slate-200 px-3 py-2 min-h-[40px] text-[12px] font-bold text-slate-600">
                    Cancel
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => setAdding(kind)}
                  className="mt-2 text-[11.5px] font-bold text-slate-500 hover:text-emerald-700 inline-flex items-center gap-1 min-h-[32px]">
                  <Plus className="h-3 w-3" /> Add to {meta.label.toLowerCase()}
                </button>
              )
            )}
          </div>
        )
      })}

      <div className="rounded-xl border border-slate-200 p-2.5">
        <p className="text-[12.5px] font-bold text-slate-800">Shared with the rest of the hub</p>
        <p className="text-[11.5px] text-slate-500 mt-0.5">
          <b>Storage locations</b> are set up above, under Stores and who keeps them. <b>Projects</b> and{' '}
          <b>vendors</b> are the hub&apos;s own lists — set up once and used by every module, never a second copy here.
          The <b>item master</b> holds {itemCount} items and grows by itself: a material IN4 names on a PO becomes an
          item on import.
        </p>
        <Link href="/warehouse/items"
          className="inline-flex items-center gap-1 text-[12px] font-bold text-emerald-700 hover:underline min-h-[36px]">
          Open the item master <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  )
}

function SyncLink() {
  return (
    <div className="space-y-2">
      <p className="text-[12px] text-slate-600 leading-snug">
        The Indent → PO Tracker upload your team already does every week carries more item names, units and
        trades than any other source we have — plus every issued purchase order with its rates. This brings
        the ones you choose into the warehouse.
      </p>
      <p className="text-[11.5px] text-slate-500 leading-snug">
        <b>Nothing is written until you say so.</b> The next screen is a preview: what would be added, what is
        left alone, and why. Your stores are never touched — the upload has no store in it.
      </p>
      <Link href="/warehouse/settings/sync"
        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-2 min-h-[40px] text-[12.5px] font-bold text-white">
        See what would come across <ChevronRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  )
}

function FromHub() {
  return (
    <div className="space-y-2">
      <div className="divide-y divide-slate-50">
        {HUB_SCREENS.map(([href, label, what]) => (
          <div key={href} className="py-2 flex items-baseline gap-2 flex-wrap">
            <Link href={href} className="text-[12.5px] font-bold text-emerald-700 hover:underline">{label}</Link>
            <span className="text-[11.5px] text-slate-500">{what}</span>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-500">
        Inherited with nothing to configure: IST dates everywhere, ₹ and Indian number grouping, mobile-first
        screens, and the email + Telegram channels. That is the point of one hub — a new module starts with all
        of it already working.
      </p>
    </div>
  )
}

function History({ history }: { history: HistoryRow[] }) {
  const [open, setOpen] = useState(false)
  const label = (k: string) => SETTINGS.find(s => s.key === k)?.label ?? k
  const shown = (v: string | null) =>
    v === null || v === '' ? 'not set' : v === 'true' ? 'on' : v === 'false' ? 'off' : v

  return (
    <Card className="p-0 shadow-sm overflow-hidden">
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
        className="w-full px-4 py-3 min-h-[52px] flex items-center gap-2 text-left hover:bg-slate-50">
        <span className="text-[12.5px] font-bold text-slate-700">Every change to these settings</span>
        <span className="text-[11px] text-slate-400">{history.length ? `last ${history.length}` : 'nothing changed yet'}</span>
        <ChevronRight className={`ml-auto h-4 w-4 text-slate-400 transition ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-slate-100 p-4">
          {history.length === 0 ? (
            <p className="text-[12px] text-slate-500">
              Nothing has been changed yet, so every setting is still on its default.
            </p>
          ) : (
            <div className="space-y-2">
              {history.map(h => {
                const who = Array.isArray(h.profiles) ? h.profiles[0] : h.profiles
                return (
                  <div key={h.id} className="text-[12px]">
                    <span className="font-semibold text-slate-800">{label(h.key)}</span>
                    <span className="text-slate-500">
                      {' '}· {shown(h.old_value)} → <b className="text-slate-700">{shown(h.new_value)}</b>
                    </span>
                    <span className="block text-[11px] text-slate-400">
                      {who?.full_name || who?.email || 'somebody'} · {formatDateTime(h.changed_at)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
          <p className="text-[11px] text-slate-400 mt-2 pt-2 border-t border-slate-100">
            Recorded so a switch can never be quietly turned off.
          </p>
        </div>
      )}
    </Card>
  )
}

/** The rules that were asked for and are not built.
 *
 *  Still listed — a switch that stores a value and changes nothing is worse
 *  than no switch, and dropping the list would leave no way to tell which
 *  rules are real. But one collapsed block at the bottom, not a footnote
 *  repeated inside four sections. */
function NotBuilt() {
  const [open, setOpen] = useState(false)
  return (
    <Card className="p-0 shadow-sm overflow-hidden">
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
        className="w-full px-4 py-3 min-h-[52px] flex items-center gap-3 text-left hover:bg-slate-50">
        <span className="text-base leading-none">🚧</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-bold text-slate-700">Asked for, not built yet</span>
          <span className="block text-[11.5px] text-slate-500 mt-0.5">
            Listed rather than shown as switches that would do nothing
          </span>
        </span>
        <span className="text-[10.5px] font-bold text-slate-400">{NOT_BUILT.length}</span>
        <ChevronRight className={`h-4 w-4 text-slate-400 flex-shrink-0 transition ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-slate-100 p-4 space-y-2.5">
          {NOT_BUILT.map(n => (
            <div key={n.label}>
              <p className="text-[12.5px] font-semibold text-slate-700">{n.label}</p>
              <p className="text-[11.5px] text-slate-500 leading-snug">{n.why}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
