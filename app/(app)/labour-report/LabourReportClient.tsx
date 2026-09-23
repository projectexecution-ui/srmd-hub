'use client'

// Labour Report — the screen. Three tabs:
//   Today     type the count per agency (prefilled from the last saved day, so
//             only what changed needs touching); Save.
//   Month     the sheet, latest day first — Cards on a phone, Table on a desk,
//             Graph (daily totals + the sheet as a heat map). The WhatsApp
//             copies live here: the day card and the month sheet (with graph),
//             both as images the clipboard takes straight into a chat.
//   Agencies  add, rename, reorder, mark "left site".
//
// Writes go straight to Supabase from the browser; RLS (labour_can('edit'))
// is the gate. Every failure is shown as a toast with the database's words —
// never a silently dropped save.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Copy, Maximize2, ArrowUp, ArrowDown, Pencil, UserX, RotateCcw } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatDate } from '@/lib/utils'

export interface LabourProject { id: string; code: string; name: string; counted: boolean }
export interface LabourAgency { id: string; name: string; sub_heads: string[]; sort_order: number; hidden: boolean }
export interface LabourEntry { report_date: string; agency_id: string; sub_head: string; count: number; updated_at: string }

interface Props {
  projects: LabourProject[]
  projectId: string | null
  agencies: LabourAgency[]
  entries: LabourEntry[]
  canEdit: boolean
  today: string
  userId: string | null
  userName: string
}

type Tab = 'today' | 'month' | 'agencies'
type MonthView = 'cards' | 'table' | 'graph'
interface Row { key: string; agencyId: string; agency: LabourAgency; head: string; sr: number }
type DayValues = Record<string, number>

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const rowKey = (agencyId: string, head: string) => agencyId + '|' + head
const parse = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd) }
const dayNo = (d: string) => String(parse(d).getDate()).padStart(2, '0')
const weekday = (d: string) => WD[parse(d).getDay()]
/** Tue 23 Sep 26 — the sheet's own date style. */
const fmtLong = (d: string) => `${weekday(d)} ${dayNo(d)} ${MON[parse(d).getMonth()]} ${String(parse(d).getFullYear()).slice(2)}`
const fmtShort = (d: string) => `${dayNo(d)} ${MON[parse(d).getMonth()]} ${String(parse(d).getFullYear()).slice(2)}`
const shiftDay = (d: string, n: number) => { const t = parse(d); t.setDate(t.getDate() + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}` }
const monthLabel = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${MON[m - 1]} ${y}` }
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

export function LabourReportClient(props: Props) {
  const { projects, projectId, canEdit, today, userId, userName } = props
  const router = useRouter()
  const project = projects.find(p => p.id === projectId) ?? null

  // ── State ────────────────────────────────────────────────────────────────
  const [agencies, setAgencies] = useState<LabourAgency[]>(props.agencies)
  const [entries, setEntries] = useState<Record<string, DayValues>>(() => fold(props.entries).values)
  const [savedAt, setSavedAt] = useState<Record<string, string>>(() => fold(props.entries).savedAt)
  const [tab, setTab] = useState<Tab>(canEdit ? 'today' : 'month')
  const [curDate, setCurDate] = useState(today)
  const [draft, setDraft] = useState<DayValues>({})
  const [prefilledFrom, setPrefilledFrom] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [month, setMonth] = useState(today.slice(0, 7))
  const [monthView, setMonthView] = useState<MonthView>('cards')
  const [shareDate, setShareDate] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { setAgencies(props.agencies); const f = fold(props.entries); setEntries(f.values); setSavedAt(f.savedAt) }, [props.agencies, props.entries])
  useEffect(() => { if (window.innerWidth >= 1024) setMonthView('table') }, [])

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    agencies.filter(a => !a.hidden).forEach((a, i) => {
      if (a.sub_heads.length) a.sub_heads.forEach(h => out.push({ key: rowKey(a.id, h), agencyId: a.id, agency: a, head: h, sr: i + 1 }))
      else out.push({ key: rowKey(a.id, ''), agencyId: a.id, agency: a, head: '', sr: i + 1 })
    })
    return out
  }, [agencies])
  const savedDates = useMemo(() => Object.keys(entries).sort(), [entries])
  const dayTotal = (d: string) => Object.values(entries[d] ?? {}).reduce((s, v) => s + v, 0)
  const prevSaved = (d: string) => { const ds = savedDates.filter(x => x < d); return ds.length ? ds[ds.length - 1] : null }

  // ── Today: load a day; prefill from the last saved day when it is new ─────
  const loadDay = (d: string) => {
    const saved = entries[d]
    const from = saved ? null : prevSaved(d)
    const base = saved ?? (from ? entries[from] : {})
    const next: DayValues = {}
    rows.forEach(r => { next[r.key] = base[r.key] ?? 0 })
    setCurDate(d); setDraft(next); setPrefilledFrom(from); setDirty(false)
  }
  // Re-derive the open day whenever the row list or the saved data changes
  // (first paint, a save, an agency added). loadDay reads the latest of both.
  useEffect(() => {
    loadDay(curDate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, entries])

  // What a cell is compared against for the "changed" tint: the saved day, or
  // for a new day the day it was prefilled from.
  const baseline: DayValues = entries[curDate] ?? (prefilledFrom ? entries[prefilledFrom] : {})
  const isChanged = (key: string) => (baseline[key] ?? 0) !== (draft[key] ?? 0)
  const total = Object.values(draft).reduce((s, v) => s + v, 0)
  const prevForDelta = prevSaved(curDate)
  const delta = prevForDelta ? total - dayTotal(prevForDelta) : null

  const guardDirty = () => { if (!dirty) return true; toast.message('Save or undo this day first — nothing is lost'); return false }
  const setVal = (key: string, n: number) => { n = Math.max(0, Math.min(999, Math.round(n || 0))); setDraft(p => ({ ...p, [key]: n })); setDirty(true) }

  const save = async () => {
    if (!projectId || !canEdit) return
    setSaving(true)
    const supabase = createClient()
    const payload = rows.map(r => ({ project_id: projectId, report_date: curDate, agency_id: r.agencyId, sub_head: r.head, count: draft[r.key] ?? 0, updated_by: userId, updated_at: new Date().toISOString() }))
    const { data, error } = await supabase.from('labour_entries').upsert(payload, { onConflict: 'project_id,report_date,agency_id,sub_head' }).select('report_date')
    setSaving(false)
    if (error || !data || data.length !== payload.length) {
      toast.error(error ? `Could not save: ${error.message}` : 'Could not save — you may not have edit rights on Labour Report')
      return
    }
    const now = new Date().toISOString()
    setEntries(p => ({ ...p, [curDate]: { ...draft } })); setSavedAt(p => ({ ...p, [curDate]: now }))
    setDirty(false); setPrefilledFrom(null)
    setMonth(curDate.slice(0, 7)); setShareDate(curDate); setTab('month')
    toast.success(`Saved ${fmtShort(curDate)} · ${total} heads · copy the card below`)
    router.refresh()
  }

  // ── Month ────────────────────────────────────────────────────────────────
  const months = useMemo(() => { const s = new Set(savedDates.map(d => d.slice(0, 7))); s.add(today.slice(0, 7)); return [...s].sort().reverse() }, [savedDates, today])
  const monthDates = useMemo(() => savedDates.filter(d => d.startsWith(month)).reverse(), [savedDates, month]) // latest first
  const monthManDays = monthDates.reduce((s, d) => s + dayTotal(d), 0)
  const latestInMonth = monthDates[0] ?? null
  const cardDate = shareDate && shareDate.startsWith(month) ? shareDate : latestInMonth
  const agencyDayValue = (a: LabourAgency, d: string): number | undefined => {
    const e = entries[d] ?? {}; const keys = a.sub_heads.length ? a.sub_heads.map(h => rowKey(a.id, h)) : [rowKey(a.id, '')]
    let s = 0, any = false; keys.forEach(k => { if (k in e) { any = true; s += e[k] } }); return any ? s : undefined
  }

  // ── Images ───────────────────────────────────────────────────────────────
  const dayCanvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => { if (tab === 'month' && cardDate && dayCanvas.current) drawDayCard(dayCanvas.current, { project: project?.code ?? '', date: cardDate, rows, values: entries[cardDate] ?? {}, by: userName }) }, [tab, cardDate, entries, rows, project, userName])
  const copyCanvas = async (c: HTMLCanvasElement, what: string) => {
    try {
      const blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/png'))
      if (!blob || !navigator.clipboard || typeof ClipboardItem === 'undefined') throw new Error('no clipboard')
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      toast.success(`${what} copied — paste it in WhatsApp`)
    } catch {
      openCanvas(c); toast.message('Copy is blocked in this browser — long-press the image to copy or save it')
    }
  }
  const openCanvas = (c: HTMLCanvasElement) => {
    const url = c.toDataURL('image/png'); const w = window.open(); if (w) { w.document.write(`<img src="${url}" style="max-width:100%">`); return }
    const ov = document.createElement('div'); ov.style.cssText = 'position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.75);display:grid;place-items:center;padding:16px;overflow:auto'
    ov.onclick = () => ov.remove(); ov.innerHTML = `<img src="${url}" alt="Report image" style="max-width:100%;max-height:100%;border-radius:12px;background:#fff">`; document.body.appendChild(ov)
  }
  const copySheet = () => {
    if (!monthDates.length) return
    const c = drawSheet({ project: project?.code ?? '', month, dates: monthDates, agencies: agencies.filter(a => !a.hidden), entries, dayTotal })
    copyCanvas(c, 'Month sheet')
  }

  // ── Agencies ─────────────────────────────────────────────────────────────
  const [newName, setNewName] = useState(''); const [newHead, setNewHead] = useState(''); const [newHeads, setNewHeads] = useState<string[]>([])
  const [renaming, setRenaming] = useState<string | null>(null); const [renameTo, setRenameTo] = useState('')
  const mutate = async (what: string, fn: (s: ReturnType<typeof createClient>) => PromiseLike<{ error: { message: string } | null }>) => {
    if (!projectId) return false
    setBusy(true); const { error } = await fn(createClient()); setBusy(false)
    if (error) { toast.error(`${what} failed: ${error.message}`); return false }
    router.refresh(); return true
  }
  const addAgency = async () => {
    const name = newName.trim(); if (!name) { toast.message('Give the agency a name first'); return }
    if (agencies.some(a => a.name.toLowerCase() === name.toLowerCase())) { toast.message(`${name} is already on the list`); return }
    const sort = Math.max(0, ...agencies.map(a => a.sort_order)) + 10
    const s = createClient()
    setBusy(true)
    const { data, error } = await s.from('labour_agencies').insert({ project_id: projectId, name, sub_heads: newHeads, sort_order: sort, created_by: userId }).select('id, name, sub_heads, sort_order, hidden').single()
    setBusy(false)
    if (error || !data) { toast.error(`Add failed: ${error?.message ?? 'no row came back'}`); return }
    setAgencies(p => [...p, data as LabourAgency]); setNewName(''); setNewHeads([]); setNewHead('')
    toast.success(`${name} added — it is on Today from now`); router.refresh()
  }
  const rename = async (a: LabourAgency) => {
    const v = renameTo.trim(); setRenaming(null); if (!v || v === a.name) return
    if (await mutate('Rename', s => s.from('labour_agencies').update({ name: v, updated_at: new Date().toISOString() }).eq('id', a.id))) setAgencies(p => p.map(x => x.id === a.id ? { ...x, name: v } : x))
  }
  const toggleHidden = async (a: LabourAgency) => {
    if (await mutate(a.hidden ? 'Show' : 'Hide', s => s.from('labour_agencies').update({ hidden: !a.hidden, updated_at: new Date().toISOString() }).eq('id', a.id))) {
      setAgencies(p => p.map(x => x.id === a.id ? { ...x, hidden: !a.hidden } : x))
      toast.success(a.hidden ? `${a.name} is back on Today` : `${a.name} marked as left site — history stays`)
    }
  }
  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= agencies.length) return
    const a = agencies[i], b = agencies[j]
    const ok = await mutate('Reorder', async s => {
      const r1 = await s.from('labour_agencies').update({ sort_order: b.sort_order }).eq('id', a.id)
      if (r1.error) return r1
      return s.from('labour_agencies').update({ sort_order: a.sort_order }).eq('id', b.id)
    })
    if (ok) setAgencies(p => { const n = [...p]; n[i] = { ...b, sort_order: a.sort_order }; n[j] = { ...a, sort_order: b.sort_order }; return n })
  }

  // ── Render ───────────────────────────────────────────────────────────────
  if (!projectId) return <div className="p-6 text-sm text-gray-600">No live project to count on. Add a project first.</div>

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'today', label: 'Today', show: canEdit },
    { id: 'month', label: 'Month', show: true },
    { id: 'agencies', label: 'Agencies', show: canEdit },
  ]

  return (
    <div className="pb-28">
      {/* Header: project picker + tabs */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 md:px-6 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-baseline gap-2 min-w-0">
              <h1 className="text-lg font-bold text-gray-900">Labour Report</h1>
              <select
                id="labour-project" aria-label="Project" value={projectId}
                onChange={e => { if (guardDirty()) router.push(`/labour-report?project=${e.target.value}`) }}
                className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-sm font-semibold text-gray-800"
              >
                {projects.map(p => <option key={p.id} value={p.id}>{p.code}{p.counted ? '' : ' · no list yet'}</option>)}
              </select>
            </div>
            <div className="text-xs text-gray-500">{userName}{canEdit ? '' : ' · view only'}</div>
          </div>
          <div role="tablist" className="mt-2 flex gap-1 overflow-x-auto">
            {tabs.filter(t => t.show).map(t => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                className={`min-h-[44px] px-4 text-sm font-semibold border-b-[3px] ${tab === t.id ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-600'}`}>
                {t.label}{t.id === 'agencies' ? <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 text-[11px] text-gray-600">{agencies.filter(a => !a.hidden).length}</span> : null}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 md:px-6 pt-4">
        {/* ── TODAY ─────────────────────────────────────────────────────── */}
        {tab === 'today' && canEdit && (
          <div className="max-w-xl mx-auto space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <button aria-label="Previous day" onClick={() => guardDirty() && loadDay(shiftDay(curDate, -1))} className="h-11 w-11 rounded-xl border border-gray-200 bg-white grid place-items-center"><ChevronLeft className="h-5 w-5" /></button>
                <input id="labour-date" type="date" value={curDate} max={today} aria-label="Report date" onChange={e => { if (e.target.value && e.target.value <= today && guardDirty()) loadDay(e.target.value) }} className="h-11 rounded-xl border border-gray-200 bg-white px-2 text-sm font-semibold" />
                <button aria-label="Next day" disabled={curDate >= today} onClick={() => guardDirty() && loadDay(shiftDay(curDate, 1))} className="h-11 w-11 rounded-xl border border-gray-200 bg-white grid place-items-center disabled:opacity-40"><ChevronRight className="h-5 w-5" /></button>
              </div>
              {dirty
                ? <Chip tone="amber">Not saved</Chip>
                : entries[curDate]
                  ? <Chip tone="green">Saved {savedAt[curDate] ? fmtTime(savedAt[curDate]) : ''}</Chip>
                  : prefilledFrom
                    ? <Chip tone="gray">Prefilled from {fmtShort(prefilledFrom)}</Chip>
                    : <Chip tone="gray">No entry yet</Chip>}
            </div>
            {prefilledFrom && !dirty && (
              <p className="text-xs text-gray-500 px-1">Yesterday&rsquo;s numbers are filled in. Change only what is different today, then Save.</p>
            )}

            <div className="rounded-2xl border border-gray-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-gray-100">
                <h2 className="text-[15px] font-semibold text-gray-900">Daily manpower · {fmtLong(curDate)}</h2>
                <span className="text-xs text-gray-500">prev = {prevForDelta ? fmtShort(prevForDelta) : 'none'}</span>
              </div>
              {agencies.filter(a => !a.hidden).map((a, i) => a.sub_heads.length ? (
                <div key={a.id} className="m-3 rounded-xl border border-gray-200 bg-gray-50">
                  <div className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-gray-800"><span className="w-5 text-right text-xs text-gray-400">{i + 1}</span>{a.name}</div>
                  {a.sub_heads.map(h => <EntryRow key={h} label={h} sr="" value={draft[rowKey(a.id, h)] ?? 0} prev={prevForDelta ? entries[prevForDelta]?.[rowKey(a.id, h)] : undefined} changed={isChanged(rowKey(a.id, h))} onChange={n => setVal(rowKey(a.id, h), n)} inBox />)}
                </div>
              ) : (
                <EntryRow key={a.id} label={a.name} sr={String(i + 1)} value={draft[rowKey(a.id, '')] ?? 0} prev={prevForDelta ? entries[prevForDelta]?.[rowKey(a.id, '')] : undefined} changed={isChanged(rowKey(a.id, ''))} onChange={n => setVal(rowKey(a.id, ''), n)} />
              ))}
              {agencies.filter(a => !a.hidden).length === 0 && <p className="p-4 text-sm text-gray-500">No agencies yet — add them on the Agencies tab.</p>}
            </div>

            {/* Fixed save bar */}
            <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white px-4 py-2.5" style={{ paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))' }}>
              <div className="max-w-xl mx-auto flex items-center gap-3">
                <div className="flex-1">
                  <div className="text-[11px] uppercase tracking-wide text-gray-500">Total manpower</div>
                  <div className="text-2xl font-bold leading-none text-gray-900 tabular-nums">{total}{delta !== null && <span className="ml-2 text-xs font-medium text-gray-500">{delta >= 0 ? '+' : ''}{delta} vs {fmtShort(prevForDelta!)}</span>}</div>
                </div>
                <button onClick={save} disabled={saving || (!dirty && !!entries[curDate])} className="min-h-[44px] rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white disabled:opacity-50">
                  {saving ? 'Saving…' : !dirty && entries[curDate] ? 'Saved' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── MONTH ─────────────────────────────────────────────────────── */}
        {tab === 'month' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <select id="labour-month" aria-label="Month" value={month} onChange={e => setMonth(e.target.value)} className="h-10 rounded-xl border border-gray-200 bg-white px-2 text-sm font-semibold">
                  {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
                </select>
                <Chip tone="gray">{monthDates.length} days · {monthManDays.toLocaleString('en-IN')} man-days</Chip>
              </div>
              <div className="inline-flex overflow-hidden rounded-xl border border-gray-200" role="group" aria-label="View">
                {(['cards', 'table', 'graph'] as MonthView[]).map(v => (
                  <button key={v} aria-pressed={monthView === v} onClick={() => setMonthView(v)} className={`min-h-[40px] px-3.5 text-sm font-semibold capitalize ${monthView === v ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600'}`}>{v}</button>
                ))}
              </div>
            </div>

            {/* Share card — where the copying happens, right after a save */}
            {cardDate && (
              <div className={`rounded-2xl border bg-white ${shareDate === cardDate ? 'border-emerald-300 ring-2 ring-emerald-100' : 'border-gray-200'}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-gray-100">
                  <h2 className="text-[15px] font-semibold text-gray-900">WhatsApp · {fmtLong(cardDate)}</h2>
                  <span className="text-xs text-gray-500">{shareDate === cardDate ? 'Just saved — copy and paste in the group' : 'Latest saved day of this month'}</span>
                </div>
                <div className="grid gap-3 p-4 md:grid-cols-[minmax(0,320px)_1fr]">
                  <canvas ref={dayCanvas} className="w-full rounded-xl border border-gray-200 bg-white" aria-label="Day card image" />
                  <div className="flex flex-col gap-2 justify-center">
                    <button onClick={() => dayCanvas.current && copyCanvas(dayCanvas.current, 'Day card')} className="min-h-[44px] rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white inline-flex items-center justify-center gap-2"><Copy className="h-4 w-4" />Copy day card</button>
                    <button onClick={copySheet} className="min-h-[44px] rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-800 inline-flex items-center justify-center gap-2"><Copy className="h-4 w-4" />Copy month sheet + graph</button>
                    <button onClick={() => dayCanvas.current && openCanvas(dayCanvas.current)} className="min-h-[40px] rounded-xl px-4 text-sm font-semibold text-emerald-700 inline-flex items-center justify-center gap-2"><Maximize2 className="h-4 w-4" />Open full size</button>
                    <p className="text-xs text-gray-500">Agencies at 0 fold into one &ldquo;Nil today&rdquo; line so the card stays short.</p>
                  </div>
                </div>
              </div>
            )}

            {monthDates.length === 0 && <p className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-500">No entries in {monthLabel(month)} yet.</p>}

            {monthView === 'cards' && monthDates.map((d, i) => {
              const prev = prevSaved(d); const t = dayTotal(d); const pd = prev ? t - dayTotal(prev) : null
              const on = rows.filter(r => (entries[d]?.[r.key] ?? 0) > 0)
              const nil = rows.filter(r => !(entries[d]?.[r.key] ?? 0)).map(r => r.head ? `${r.agency.name.split(' (')[0]} ${r.head}` : r.agency.name)
              return (
                <details key={d} open={i === 0} className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
                  <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 px-4 py-2">
                    <span className="text-[15px] font-semibold text-gray-900">{fmtLong(d)}<span className="block text-xs font-normal text-gray-500">{savedAt[d] ? `Saved ${fmtTime(savedAt[d])}` : ''}</span></span>
                    <span className="text-xl font-bold tabular-nums text-gray-900">{t}{pd !== null && <span className="ml-1 text-[11px] font-medium text-gray-500">{pd >= 0 ? '+' : ''}{pd}</span>}</span>
                  </summary>
                  <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 border-t border-gray-100 px-4 pb-3 pt-2 text-[13px]">
                    {on.map(r => <FragmentRow key={r.key} name={r.head ? `${r.agency.name} · ${r.head}` : r.agency.name} value={entries[d][r.key]} />)}
                    {nil.length > 0 && <div className="col-span-2 pt-1 text-xs text-gray-500">Nil: {nil.join(', ')}</div>}
                  </div>
                </details>
              )
            })}

            {monthView === 'table' && monthDates.length > 0 && (
              <SheetTable dates={monthDates} agencies={agencies.filter(a => !a.hidden)} entries={entries} dayTotal={dayTotal} canEdit={canEdit}
                onCell={(d) => { if (guardDirty()) { loadDay(d); setTab('today') } }} />
            )}

            {monthView === 'graph' && monthDates.length > 0 && (
              <GraphView dates={monthDates} agencies={agencies.filter(a => !a.hidden)} agencyDayValue={agencyDayValue} dayTotal={dayTotal} />
            )}
            {monthView === 'table' && <p className="px-1 text-xs text-gray-500">Latest day first. Days with no entry are skipped, like the Excel. {canEdit ? 'Tap a cell to fix that day.' : ''}</p>}
          </div>
        )}

        {/* ── AGENCIES ──────────────────────────────────────────────────── */}
        {tab === 'agencies' && canEdit && (
          <div className="max-w-xl mx-auto space-y-3">
            <div className="rounded-2xl border border-gray-200 bg-white">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100"><h2 className="text-[15px] font-semibold text-gray-900">Agencies on {project?.code}</h2><span className="text-xs text-gray-500">order = order on Today</span></div>
              {agencies.map((a, i) => (
                <div key={a.id} className={`flex min-h-[52px] items-center gap-2 px-3 py-1 border-t border-gray-100 first:border-t-0 ${a.hidden ? 'opacity-60' : ''}`}>
                  <span className="w-5 text-right text-xs text-gray-400">{i + 1}</span>
                  {renaming === a.id ? (
                    <input autoFocus value={renameTo} onChange={e => setRenameTo(e.target.value)} onBlur={() => rename(a)} onKeyDown={e => { if (e.key === 'Enter') rename(a); if (e.key === 'Escape') setRenaming(null) }} aria-label="New name" className="flex-1 h-10 rounded-lg border border-gray-200 px-2 text-sm" />
                  ) : (
                    <div className="flex-1 min-w-0 text-sm">
                      <div className={`font-medium text-gray-900 truncate ${a.hidden ? 'line-through' : ''}`}>{a.name}</div>
                      {a.sub_heads.length > 0 && <div className="text-[11px] text-gray-500 truncate">{a.sub_heads.join(' · ')}</div>}
                    </div>
                  )}
                  <IconBtn label="Move up" disabled={busy || i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></IconBtn>
                  <IconBtn label="Move down" disabled={busy || i === agencies.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></IconBtn>
                  <IconBtn label="Rename" disabled={busy} onClick={() => { setRenaming(a.id); setRenameTo(a.name) }}><Pencil className="h-4 w-4" /></IconBtn>
                  <IconBtn label={a.hidden ? 'Back on site' : 'Left site'} disabled={busy} onClick={() => toggleHidden(a)}>{a.hidden ? <RotateCcw className="h-4 w-4" /> : <UserX className="h-4 w-4" />}</IconBtn>
                </div>
              ))}
            </div>
            <form className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3" onSubmit={e => { e.preventDefault(); addAgency() }}>
              <h2 className="text-[15px] font-semibold text-gray-900">Add an agency</h2>
              <label className="block text-xs font-semibold text-gray-600">Name
                <input id="labour-new-name" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Lift installer" className="mt-1 h-11 w-full rounded-xl border border-gray-200 px-3 text-sm font-normal text-gray-900" />
              </label>
              <label className="block text-xs font-semibold text-gray-600">Sub-heads (optional)
                <div className="mt-1 flex gap-2">
                  <input id="labour-new-head" value={newHead} onChange={e => setNewHead(e.target.value)} placeholder="e.g. Mason, Labour" className="h-11 flex-1 rounded-xl border border-gray-200 px-3 text-sm font-normal text-gray-900" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addHeads() } }} />
                  <button type="button" onClick={addHeads} className="h-11 rounded-xl border border-gray-200 px-4 text-sm font-semibold">Add</button>
                </div>
              </label>
              {newHeads.length > 0 && <div className="flex flex-wrap gap-1.5">{newHeads.map(h => <button type="button" key={h} onClick={() => setNewHeads(p => p.filter(x => x !== h))} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">{h} ×</button>)}</div>}
              <button type="submit" disabled={busy} className="min-h-[44px] rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white disabled:opacity-50">Add agency</button>
            </form>
            <p className="px-1 text-xs text-gray-500">&ldquo;Left site&rdquo; takes an agency off Today; every past day keeps its numbers.</p>
          </div>
        )}
      </div>
    </div>
  )

  function addHeads() {
    const parts = newHead.split(',').map(s => s.trim()).filter(Boolean)
    if (!parts.length) return
    setNewHeads(p => [...p, ...parts.filter(x => !p.includes(x))]); setNewHead('')
  }
}

// ── Small pieces ───────────────────────────────────────────────────────────
function fold(list: LabourEntry[]) {
  const values: Record<string, DayValues> = {}; const savedAt: Record<string, string> = {}
  for (const e of list) {
    (values[e.report_date] ??= {})[rowKey(e.agency_id, e.sub_head)] = e.count
    if (!savedAt[e.report_date] || e.updated_at > savedAt[e.report_date]) savedAt[e.report_date] = e.updated_at
  }
  return { values, savedAt }
}

function Chip({ tone, children }: { tone: 'green' | 'amber' | 'gray'; children: ReactNode }) {
  const cls = tone === 'green' ? 'bg-emerald-100 text-emerald-800' : tone === 'amber' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>{children}</span>
}
function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="h-10 w-10 shrink-0 grid place-items-center rounded-lg border border-gray-200 bg-white text-gray-600 disabled:opacity-40">{children}</button>
}
function FragmentRow({ name, value }: { name: string; value: number }) {
  return <><span className="truncate text-gray-800">{name}</span><span className="text-right font-semibold tabular-nums">{value}</span></>
}
function EntryRow({ label, sr, value, prev, changed, onChange, inBox }: { label: string; sr: string; value: number; prev: number | undefined; changed: boolean; onChange: (n: number) => void; inBox?: boolean }) {
  return (
    <div className={`flex min-h-[52px] items-center gap-2 border-t border-gray-100 py-1 ${inBox ? 'bg-white px-3' : 'px-4'}`}>
      <span className="w-5 text-right text-xs text-gray-400">{sr}</span>
      <div className="flex-1 min-w-0 text-sm font-medium text-gray-900 truncate">{label}</div>
      <div className="w-10 text-right text-[11px] leading-tight text-gray-400"><b className="block text-[13px] font-medium text-gray-600">{prev === undefined ? '–' : prev}</b>prev</div>
      <div className="flex items-center gap-0.5">
        <button type="button" aria-label="Less" onClick={() => onChange(value - 1)} className="h-11 w-11 grid place-items-center rounded-xl border border-gray-200 bg-white text-xl leading-none text-gray-600">−</button>
        <input type="number" inputMode="numeric" min={0} max={999} value={value} onFocus={e => e.target.select()} onChange={e => onChange(Number(e.target.value))} aria-label={`${label} count`}
          className={`h-11 w-14 rounded-xl border text-center text-[17px] font-semibold tabular-nums ${changed ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 bg-white'}`} />
        <button type="button" aria-label="More" onClick={() => onChange(value + 1)} className="h-11 w-11 grid place-items-center rounded-xl border border-gray-200 bg-white text-xl leading-none text-gray-600">+</button>
      </div>
    </div>
  )
}

function SheetTable({ dates, agencies, entries, dayTotal, canEdit, onCell }: { dates: string[]; agencies: LabourAgency[]; entries: Record<string, DayValues>; dayTotal: (d: string) => number; canEdit: boolean; onCell: (d: string) => void }) {
  const latest = dates[0]
  const cell = (d: string, key: string) => {
    const v = entries[d]?.[key]
    return (
      <td key={d} onClick={() => canEdit && onCell(d)} title={canEdit ? `Fix ${fmtShort(d)}` : undefined}
        className={`h-9 border-b border-r border-gray-100 px-2 text-center text-[13px] tabular-nums whitespace-nowrap ${d === latest ? 'bg-emerald-50 font-bold' : ''} ${v === undefined ? 'text-gray-300' : v === 0 ? 'text-gray-400' : 'text-gray-900'} ${canEdit ? 'cursor-pointer hover:outline hover:outline-2 hover:-outline-offset-2 hover:outline-emerald-500' : ''}`}>
        {v === undefined ? '–' : v}
      </td>
    )
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
      <table className="min-w-full border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-[4] min-w-[190px] max-w-[240px] border-b border-r border-gray-100 bg-gray-50 px-3 text-left text-xs font-semibold text-gray-600 h-11">Agency</th>
            {dates.map(d => <th key={d} className={`sticky top-0 z-[2] h-11 border-b border-r border-gray-100 px-2 text-center ${d === latest ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-50 text-gray-600'}`}><span className="block text-sm font-bold">{dayNo(d)}</span><span className="block text-[10px] uppercase tracking-wide">{weekday(d)}</span></th>)}
          </tr>
        </thead>
        <tbody>
          {agencies.map((a, i) => a.sub_heads.length ? (
            <FragmentRows key={a.id}>
              <tr className="bg-gray-50">
                <td className="sticky left-0 z-[3] border-b border-r border-gray-100 bg-gray-50 px-3 h-9 font-semibold text-gray-900 whitespace-normal"><span className="mr-1.5 text-[11px] text-gray-400">{i + 1}</span>{a.name}</td>
                {dates.map(d => { const keys = a.sub_heads.map(h => rowKey(a.id, h)); const e = entries[d] ?? {}; const any = keys.some(k => k in e); const s = keys.reduce((t, k) => t + (e[k] ?? 0), 0); return <td key={d} className={`h-9 border-b border-r border-gray-100 px-2 text-center font-semibold tabular-nums ${d === latest ? 'bg-emerald-50' : 'bg-gray-50'} ${any ? 'text-gray-900' : 'text-gray-300'}`}>{any ? s : '–'}</td> })}
              </tr>
              {a.sub_heads.map(h => <tr key={h}><td className="sticky left-0 z-[3] border-b border-r border-gray-100 bg-white pl-9 pr-3 h-9 text-gray-700">{h}</td>{dates.map(d => cell(d, rowKey(a.id, h)))}</tr>)}
            </FragmentRows>
          ) : (
            <tr key={a.id}><td className="sticky left-0 z-[3] border-b border-r border-gray-100 bg-white px-3 h-9 font-medium text-gray-900 whitespace-normal"><span className="mr-1.5 text-[11px] text-gray-400">{i + 1}</span>{a.name}</td>{dates.map(d => cell(d, rowKey(a.id, '')))}</tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="sticky bottom-0 left-0 z-[4] border-t-2 border-r border-gray-200 bg-gray-50 px-3 h-10 text-sm font-bold text-gray-900">Total</td>
            {dates.map(d => <td key={d} className={`sticky bottom-0 z-[2] h-10 border-t-2 border-r border-gray-200 px-2 text-center text-sm font-bold tabular-nums ${d === latest ? 'bg-emerald-100 text-emerald-900' : 'bg-gray-50 text-gray-900'}`}>{dayTotal(d)}</td>)}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
function FragmentRows({ children }: { children: ReactNode }) { return <>{children}</> }

function GraphView({ dates, agencies, agencyDayValue, dayTotal }: { dates: string[]; agencies: LabourAgency[]; agencyDayValue: (a: LabourAgency, d: string) => number | undefined; dayTotal: (d: string) => number }) {
  const totals = dates.map(d => dayTotal(d)); const peak = Math.max(1, ...totals); const md = totals.reduce((s, v) => s + v, 0)
  const peakI = totals.indexOf(peak); const latest = totals[0]; const prev = totals[1]
  const [tip, setTip] = useState<number | null>(null)
  const W = 720, H = 240, padL = 40, padR = 12, padT = 24, padB = 34, n = dates.length
  const max = peak * 1.15, slot = (W - padL - padR) / n, bw = Math.max(6, slot * 0.62)
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max)
  const step = max > 150 ? 50 : 25; const grid: number[] = []; for (let g = 0; g <= max; g += step) grid.push(g)
  return (
    <div className="space-y-3">
      <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
        <Tile label="Latest day" num={latest} small={fmtShort(dates[0])} sub={prev !== undefined ? `${latest - prev >= 0 ? '+' : ''}${latest - prev} vs ${fmtShort(dates[1])}` : ''} />
        <Tile label="Month man-days" num={md.toLocaleString('en-IN')} small={monthLabel(dates[0].slice(0, 7))} sub={`${n} working days`} />
        <Tile label="Daily average" num={Math.round(md / n)} small="heads / day" sub="" />
        <Tile label="Peak day" num={peak} small={fmtShort(dates[peakI])} sub="highest this month" />
      </div>
      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="mb-2 flex items-baseline justify-between"><h2 className="text-[15px] font-semibold text-gray-900">Heads on site, day by day</h2><span className="text-xs text-gray-500">latest first, same order as the sheet</span></div>
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Daily total manpower" className="block w-full h-auto" onMouseLeave={() => setTip(null)}>
            {grid.map(g => <g key={g}><line x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} stroke="#F1F5F9" /><text x={padL - 8} y={y(g) + 4} textAnchor="end" fontSize="11" fill="#6B7280">{g}</text></g>)}
            <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} stroke="#E5E7EB" />
            {dates.map((d, i) => { const x = padL + i * slot + (slot - bw) / 2; const top = y(totals[i]); return (
              <g key={d} onMouseEnter={() => setTip(i)} onTouchStart={() => setTip(i)}>
                <rect x={x} y={top} width={bw} height={Math.max(0, y(0) - top)} rx={3} fill="#059669" opacity={i === 0 ? 1 : 0.55} />
                {(i === 0 || i === peakI || n <= 12) && <text x={x + bw / 2} y={top - 6} textAnchor="middle" fontSize="11" fontWeight="700" fill="#111827">{totals[i]}</text>}
                {(n <= 14 || i % 2 === 0) && <text x={x + bw / 2} y={H - 12} textAnchor="middle" fontSize="11" fill="#6B7280">{parse(d).getDate()}</text>}
                <rect x={padL + i * slot} y={0} width={slot} height={H} fill="transparent" />
              </g>
            ) })}
          </svg>
          {tip !== null && <div className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg bg-gray-900 px-2 py-1 text-xs text-white whitespace-nowrap" style={{ left: `${(padL + tip * slot + slot / 2) / W * 100}%`, top: `${y(totals[tip]) / H * 100}%` }}>{fmtLong(dates[tip])} · {totals[tip]} heads</div>}
        </div>
      </div>
      <div>
        <div className="mb-2 flex items-baseline justify-between px-1"><h2 className="text-[15px] font-semibold text-gray-900">The sheet as a heat map</h2><span className="text-xs text-gray-500">darker = more of that agency&rsquo;s people that day</span></div>
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="min-w-full border-separate border-spacing-0 text-[13px]">
            <thead><tr>
              <th className="sticky left-0 z-[3] min-w-[190px] border-b border-r border-gray-100 bg-gray-50 px-3 h-11 text-left text-xs font-semibold text-gray-600">Agency</th>
              {dates.map(d => <th key={d} className={`h-11 border-b border-r border-gray-100 px-2 text-center ${d === dates[0] ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-50 text-gray-600'}`}><span className="block text-sm font-bold">{dayNo(d)}</span><span className="block text-[10px] uppercase">{weekday(d)}</span></th>)}
            </tr></thead>
            <tbody>
              {agencies.map((a, i) => { const vals = dates.map(d => agencyDayValue(a, d)); const mx = Math.max(0, ...vals.filter((v): v is number => v !== undefined)); return (
                <tr key={a.id}>
                  <td className="sticky left-0 z-[3] border-b border-r border-gray-100 bg-white px-3 h-9 font-medium text-gray-900 whitespace-normal"><span className="mr-1.5 text-[11px] text-gray-400">{i + 1}</span>{a.name}{a.sub_heads.length > 0 && <span className="block text-[11px] text-gray-500">{a.sub_heads.join(' · ')}</span>}</td>
                  {vals.map((v, k) => <td key={dates[k]} className={`h-9 border-b border-r border-gray-100 px-2 text-center tabular-nums ${v === undefined ? 'text-gray-300' : v === 0 ? 'text-gray-400' : 'font-semibold text-gray-900'}`} style={v ? { background: `rgba(5,150,105,${(0.12 + 0.6 * v / (mx || 1)).toFixed(2)})` } : undefined}>{v === undefined ? '–' : v}</td>)}
                </tr>
              ) })}
            </tbody>
            <tfoot><tr>
              <td className="sticky left-0 z-[3] border-t-2 border-r border-gray-200 bg-gray-50 px-3 h-10 text-sm font-bold text-gray-900">Total</td>
              {totals.map((v, k) => <td key={dates[k]} className="h-10 border-t-2 border-r border-gray-200 px-2 text-center text-sm font-bold tabular-nums text-gray-900" style={{ background: `rgba(5,150,105,${(0.12 + 0.6 * v / peak).toFixed(2)})` }}>{v}</td>)}
            </tr></tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}
function Tile({ label, num, small, sub }: { label: string; num: number | string; small: string; sub: string }) {
  return <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3"><div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div><div className="mt-1 text-2xl font-bold leading-tight text-gray-900 tabular-nums">{num}<span className="ml-1.5 text-xs font-medium text-gray-500">{small}</span></div>{sub && <div className="mt-0.5 text-xs text-gray-500">{sub}</div>}</div>
}

// ── Canvas images ──────────────────────────────────────────────────────────
function fitText(ctx: CanvasRenderingContext2D, s: string, w: number) { if (ctx.measureText(s).width <= w) return s; while (s.length && ctx.measureText(s + '…').width > w) s = s.slice(0, -1); return s + '…' }
function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number, maxLines: number) {
  const words = text.split(' '); let line = '', n = 0
  for (let i = 0; i < words.length; i++) {
    const test = line + words[i] + ' '
    if (ctx.measureText(test).width > maxW && line) { if (++n === maxLines) { ctx.fillText(fitText(ctx, line + words.slice(i).join(' '), maxW), x, y); return } ctx.fillText(line, x, y); line = words[i] + ' '; y += lh }
    else line = test
  }
  ctx.fillText(line, x, y)
}
function drawDayCard(c: HTMLCanvasElement, o: { project: string; date: string; rows: Row[]; values: DayValues; by: string }) {
  const ctx = c.getContext('2d'); if (!ctx) return
  const list = o.rows.map(r => ({ r, v: o.values[r.key] ?? 0 })); const on = list.filter(x => x.v > 0), off = list.filter(x => !x.v)
  const W = 1080, lineH = 62, top = 250, bottom = 200 + (off.length ? 110 : 0), H = top + on.length * lineH + bottom
  c.width = W; c.height = H
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#047857'; ctx.fillRect(0, 0, W, 150)
  ctx.fillStyle = '#FFFFFF'; ctx.textBaseline = 'middle'; ctx.font = `700 44px ${FONT}`; ctx.fillText(`${o.project} · Daily Labour Report`, 48, 62)
  ctx.font = `500 32px ${FONT}`; ctx.globalAlpha = .9; ctx.fillText(fmtLong(o.date), 48, 112); ctx.globalAlpha = 1
  const total = list.reduce((s, x) => s + x.v, 0)
  ctx.textAlign = 'right'; ctx.font = `700 84px ${FONT}`; ctx.fillText(String(total), W - 48, 76); ctx.font = `600 22px ${FONT}`; ctx.fillText('TOTAL', W - 48, 128); ctx.textAlign = 'left'
  let y = top - 20
  on.forEach((x, i) => {
    if (i % 2 === 0) { ctx.fillStyle = '#F5F7F4'; ctx.fillRect(32, y - lineH / 2, W - 64, lineH) }
    ctx.fillStyle = '#6B7280'; ctx.font = `500 24px ${FONT}`; ctx.fillText(String(x.r.sr), 52, y)
    ctx.fillStyle = '#111827'; ctx.font = `500 30px ${FONT}`; ctx.fillText(fitText(ctx, x.r.head ? `${x.r.agency.name} · ${x.r.head}` : x.r.agency.name, 760), 110, y)
    ctx.strokeStyle = '#D1D5DB'; ctx.setLineDash([4, 8]); ctx.beginPath(); ctx.moveTo(880, y); ctx.lineTo(960, y); ctx.stroke(); ctx.setLineDash([])
    ctx.textAlign = 'right'; ctx.font = `700 34px ${FONT}`; ctx.fillText(String(x.v), W - 60, y); ctx.textAlign = 'left'
    y += lineH
  })
  if (off.length) { y += 24; ctx.fillStyle = '#6B7280'; ctx.font = `500 24px ${FONT}`; wrapText(ctx, 'Nil today: ' + off.map(x => x.r.head ? `${x.r.agency.name.split(' (')[0]} ${x.r.head}` : x.r.agency.name).join(', '), 52, y, W - 104, 34, 3); y += 110 }
  ctx.fillStyle = '#6B7280'; ctx.font = `500 22px ${FONT}`; ctx.fillText(`Entered by ${o.by} · CT Hub · Labour Report`, 52, H - 60)
  ctx.textAlign = 'right'; ctx.fillText(`${on.length} agencies on site`, W - 48, H - 60); ctx.textAlign = 'left'
}
function drawSheet(o: { project: string; month: string; dates: string[]; agencies: LabourAgency[]; entries: Record<string, DayValues>; dayTotal: (d: string) => number }): HTMLCanvasElement {
  const c = document.createElement('canvas'); const ds = o.dates
  const lines = o.agencies.reduce((n, a) => n + 1 + a.sub_heads.length, 0) + 1
  const colW = 74, nameW = 420, rowH = 44, chartH = 300, W = Math.max(1080, nameW + ds.length * colW + 48), H = 150 + chartH + 40 + (lines + 1) * rowH + 60
  c.width = W; c.height = H; const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.textBaseline = 'middle'
  ctx.fillStyle = '#111827'; ctx.font = `700 40px ${FONT}`; ctx.fillText(`${o.project} · Daily Labour Report · ${monthLabel(o.month)}`, 24, 50)
  ctx.font = `500 22px ${FONT}`; ctx.fillStyle = '#6B7280'; ctx.fillText('Latest day first · – = not yet on site', 24, 96)
  // ── the graph: daily totals as columns, aligned to the sheet's date columns
  const totals = ds.map(d => o.dayTotal(d)); const peak = Math.max(1, ...totals)
  const gTop = 130, gBottom = gTop + chartH - 40, gx = (i: number) => 24 + nameW + i * colW
  ctx.strokeStyle = '#E5E7EB'; ctx.fillStyle = '#6B7280'; ctx.font = `500 18px ${FONT}`; ctx.textAlign = 'right'
  const step = peak > 150 ? 50 : 25
  for (let g = 0; g <= peak * 1.1; g += step) { const yy = gBottom - (gBottom - gTop) * g / (peak * 1.1); ctx.beginPath(); ctx.moveTo(24 + nameW, yy); ctx.lineTo(W - 24, yy); ctx.stroke(); ctx.fillText(String(g), 24 + nameW - 10, yy) }
  ctx.textAlign = 'left'; ctx.fillStyle = '#111827'; ctx.font = `600 22px ${FONT}`; ctx.fillText('Heads on site, day by day', 40, gTop + 10)
  ctx.font = `500 18px ${FONT}`; ctx.fillStyle = '#6B7280'; wrapText(ctx, `Month ${totals.reduce((s, v) => s + v, 0).toLocaleString('en-IN')} man-days · ${ds.length} days · peak ${peak}`, 40, gTop + 46, nameW - 60, 24, 3)
  totals.forEach((v, i) => {
    const h = (gBottom - gTop) * v / (peak * 1.1); const x = gx(i) + 14
    ctx.fillStyle = i === 0 ? '#047857' : 'rgba(5,150,105,.55)'; ctx.fillRect(x, gBottom - h, colW - 28, h)
    ctx.fillStyle = '#111827'; ctx.font = `700 18px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(String(v), gx(i) + colW / 2, gBottom - h - 14); ctx.textAlign = 'left'
  })
  // ── the sheet
  let y = 150 + chartH + 40
  ctx.fillStyle = '#F3F4F6'; ctx.fillRect(24, y - rowH / 2, W - 48, rowH)
  ctx.fillStyle = '#111827'; ctx.font = `600 22px ${FONT}`; ctx.fillText('Agency', 40, y)
  ctx.textAlign = 'center'
  ds.forEach((d, i) => { ctx.font = `700 24px ${FONT}`; ctx.fillStyle = '#111827'; ctx.fillText(dayNo(d), gx(i) + colW / 2, y - 6); ctx.font = `500 13px ${FONT}`; ctx.fillStyle = '#6B7280'; ctx.fillText(weekday(d).toUpperCase(), gx(i) + colW / 2, y + 14) })
  ctx.textAlign = 'left'; y += rowH
  const line = (name: string, vals: (number | undefined)[], opts: { bold?: boolean; fill?: string; indent?: number }) => {
    if (opts.fill) { ctx.fillStyle = opts.fill; ctx.fillRect(24, y - rowH / 2, W - 48, rowH) }
    ctx.fillStyle = opts.bold ? '#111827' : '#374151'; ctx.font = `${opts.bold ? '700' : '500'} 22px ${FONT}`
    ctx.fillText(fitText(ctx, name, nameW - 30 - (opts.indent || 0)), 40 + (opts.indent || 0), y)
    ctx.textAlign = 'center'
    vals.forEach((v, i) => { if (i === 0) { ctx.fillStyle = '#D1FAE5'; ctx.fillRect(gx(0), y - rowH / 2, colW, rowH) } ctx.fillStyle = v === undefined ? '#D1D5DB' : v === 0 ? '#9CA3AF' : '#111827'; ctx.font = `${opts.bold || i === 0 ? '700' : '500'} 22px ${FONT}`; ctx.fillText(v === undefined ? '–' : String(v), gx(i) + colW / 2, y) })
    ctx.textAlign = 'left'; ctx.strokeStyle = '#F3F4F6'; ctx.beginPath(); ctx.moveTo(24, y + rowH / 2); ctx.lineTo(W - 24, y + rowH / 2); ctx.stroke(); y += rowH
  }
  o.agencies.forEach((a, i) => {
    if (a.sub_heads.length) {
      line(`${i + 1}  ${a.name}`, ds.map(d => { const e = o.entries[d] ?? {}; const ks = a.sub_heads.map(h => rowKey(a.id, h)); return ks.some(k => k in e) ? ks.reduce((t, k) => t + (e[k] ?? 0), 0) : undefined }), { bold: true, fill: '#F9FAFB' })
      a.sub_heads.forEach(h => line(h, ds.map(d => o.entries[d]?.[rowKey(a.id, h)]), { indent: 40 }))
    } else line(`${i + 1}  ${a.name}`, ds.map(d => o.entries[d]?.[rowKey(a.id, '')]), {})
  })
  line('Total', totals, { bold: true, fill: '#F3F4F6' })
  ctx.fillStyle = '#6B7280'; ctx.font = `500 20px ${FONT}`; ctx.fillText(`CT Hub · Labour Report · ${formatDate(new Date())}`, 40, H - 30)
  return c
}
