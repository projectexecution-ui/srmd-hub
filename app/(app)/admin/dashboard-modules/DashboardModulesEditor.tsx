'use client'
import { bumpShell } from '@/lib/shell-actions'
import { useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Loader2, Check, Eye, EyeOff, Pencil, Search, ChevronDown, ChevronRight, Box } from 'lucide-react'
import { cn } from '@/lib/utils'
import { confirm } from '@/components/ui/confirm-dialog'
import { TILE_TONES } from '@/lib/modules'
import { moduleMetaMap } from '../permissions/groups'

interface ModuleRow {
  slug: string
  label: string
  description: string
  enabled: boolean
}

interface Group { title: string; rows: ModuleRow[] }

interface Props {
  groups: Group[]
  /** True iff the current user can rename module labels (admin / Portal Owner). */
  canRename?: boolean
}

export default function DashboardModulesEditor({ groups: initialGroups, canRename = false }: Props) {
  const [groups, setGroups] = useState(initialGroups)
  const [busy, setBusy] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editingSlug, setEditingSlug] = useState<string | null>(null)
  const [q, setQ] = useState('')
  // Groups collapsed by default so the screen opens as a short, calm summary;
  // open a group to toggle its modules. Search overrides collapse.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(initialGroups.map(g => g.title)))

  const allRows = groups.flatMap(g => g.rows)
  const totalOn = allRows.filter(r => r.enabled).length
  const searching = q.trim() !== ''

  const shown = useMemo(() => {
    if (!searching) return groups
    const s = q.trim().toLowerCase()
    return groups
      .map(g => ({ title: g.title, rows: g.rows.filter(r => r.label.toLowerCase().includes(s) || r.slug.toLowerCase().includes(s) || r.description.toLowerCase().includes(s)) }))
      .filter(g => g.rows.length > 0)
  }, [groups, q, searching])

  const allOpen = groups.length > 0 && groups.every(g => !collapsed.has(g.title))
  const toggleCollapse = (t: string) => setCollapsed(s => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n })
  const setAll = (open: boolean) => setCollapsed(open ? new Set() : new Set(groups.map(g => g.title)))

  async function toggle(row: ModuleRow) {
    const slug = row.slug
    // Turning a module OFF hides it for the whole team — confirm first, since
    // a stray tap could hide something like Indents or Invoices for everyone.
    if (row.enabled) {
      const ok = await confirm({
        title: `Hide “${row.label}” from everyone?`,
        message: `It will disappear from the dashboard and sidebar for the whole team — including you. You can turn it back on from this page anytime.`,
        confirmLabel: 'Hide it',
      })
      if (!ok) return
    }
    let nextValue: boolean | null = null
    const prev = groups
    setGroups(gs => gs.map(g => ({
      ...g,
      rows: g.rows.map(r => {
        if (r.slug !== slug) return r
        nextValue = !r.enabled
        return { ...r, enabled: nextValue }
      }),
    })))
    if (nextValue === null) return
    setBusy(slug); setError(null)
    const supabase = createClient()
    // Select the row back so we can CONFIRM the write actually landed. If RLS
    // silently filters the write (no permission), Supabase returns no error and
    // no rows — without this check the toggle would reload as if it "worked".
    const { data, error } = await supabase
      .from('module_visibility')
      .upsert({ slug, enabled: nextValue }, { onConflict: 'slug' })
      .select('enabled')
      .maybeSingle()
    setBusy(null)
    if (error || !data || data.enabled !== nextValue) {
      setGroups(prev)
      setError(
        error
          ? `${slug}: ${error.message}`
          : `Couldn't save “${row.label}”. You may not have permission to change modules — sign in as an Admin or Portal Owner.`,
      )
      return
    }
    await bumpShell()
    // The sidebar + dashboard tiles read module_visibility from the shared app
    // layout, which does NOT reliably re-render on a client-side router.refresh()
    // (the same reason renameLabel below does a full reload). A hard reload
    // guarantees every surface — sidebar, dashboard tiles, and page gating —
    // re-reads the new on/off state, so a module you switch off is reliably
    // off everywhere at once, not "sometimes still there until I refresh".
    window.location.reload()
  }

  async function renameLabel(slug: string, nextLabel: string, nextDescription: string) {
    const trimmed = nextLabel.trim()
    if (!trimmed) { setEditingSlug(null); return }
    // Optimistic
    const prev = groups
    setGroups(gs => gs.map(g => ({
      ...g,
      rows: g.rows.map(r => r.slug === slug ? { ...r, label: trimmed, description: nextDescription } : r),
    })))
    setBusy(slug); setError(null); setEditingSlug(null)
    const supabase = createClient()
    const { error } = await supabase.rpc('set_module_label', {
      p_slug: slug,
      p_label: trimmed,
      p_description: nextDescription,
    })
    setBusy(null)
    if (error) {
      setGroups(prev)
      setError(`${slug}: ${error.message}`)
      return
    }
    setSaved(slug)
    // A module name shows in the sidebar + dashboard tile, which live in the
    // shared app layout and DON'T re-render on a client-side router.refresh().
    // Do a full reload so the new name propagates everywhere at once — no more
    // "I renamed it but it still says the old name" until a manual refresh.
    window.location.reload()
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}

      {/* Summary + search */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-gray-600"><b className="tabular-nums text-gray-900">{totalOn}</b> of {allRows.length} modules on</span>
        <div className="relative ml-auto w-full sm:w-auto sm:min-w-[220px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search modules…"
            className="h-9 w-full rounded-lg border border-gray-300 bg-white pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
        </div>
        {!searching && groups.length > 0 && (
          <button type="button" onClick={() => setAll(!allOpen)} className="text-xs font-medium text-blue-600 hover:underline whitespace-nowrap">
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-500">No modules match “{q}”.</div>
      ) : shown.map(g => {
        const onCount = g.rows.filter(r => r.enabled).length
        const open = searching || !collapsed.has(g.title)
        return (
          <Card key={g.title} className="overflow-hidden">
            <button type="button" onClick={() => { if (!searching) toggleCollapse(g.title) }}
              className="flex w-full items-center gap-2 px-5 py-3 text-left hover:bg-gray-50">
              {!searching && (open ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />)}
              <h3 className="text-sm font-bold uppercase tracking-wide text-gray-700">{g.title}</h3>
              <span className="ml-auto text-xs text-gray-500">
                <b className={onCount > 0 ? 'text-green-700' : 'text-gray-400'}>{onCount}</b> of {g.rows.length} on
              </span>
            </button>
            {open && (
              <CardContent className="pt-0 pb-2">
                <ul className="divide-y divide-gray-100">
                  {g.rows.map(r => {
                    const isBusy = busy === r.slug
                    const isSaved = saved === r.slug
                    const meta = moduleMetaMap.get(r.slug)
                    const tone = meta ? TILE_TONES[meta.tone] : TILE_TONES.slate
                    const Icon = meta?.icon ?? Box
                    return (
                      <li key={r.slug} className="flex items-center gap-3 py-3">
                        <span className={cn('inline-flex h-8 w-8 items-center justify-center rounded-lg flex-shrink-0', tone.bg, tone.ic, !r.enabled && 'opacity-50')}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          {editingSlug === r.slug && canRename ? (
                            <LabelEditor
                              initialLabel={r.label}
                              initialDescription={r.description}
                              onCancel={() => setEditingSlug(null)}
                              onSave={(lbl, desc) => renameLabel(r.slug, lbl, desc)}
                            />
                          ) : (
                            <>
                              <div className="flex items-center gap-2">
                                <span className={cn('font-medium', r.enabled ? 'text-gray-900' : 'text-gray-400')}>{r.label}</span>
                                <span className="text-[11px] font-mono text-gray-400">{r.slug}</span>
                                {canRename && (
                                  <button type="button" onClick={() => setEditingSlug(r.slug)} className="text-gray-300 hover:text-blue-600" title="Rename module">
                                    <Pencil className="h-3 w-3" />
                                  </button>
                                )}
                              </div>
                              <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{r.description}</p>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {isSaved && (
                            <span className="text-[11px] text-green-700 font-semibold inline-flex items-center gap-0.5"><Check className="h-3 w-3" /> saved</span>
                          )}
                          <button onClick={() => toggle(r)} disabled={isBusy}
                            title={r.enabled ? 'Click to hide from everyone' : 'Click to show to everyone'}
                            className={cn('relative inline-flex h-7 w-12 items-center rounded-full transition-colors', r.enabled ? 'bg-green-500' : 'bg-gray-300', isBusy && 'opacity-60 cursor-wait')}>
                            <span className={cn('inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform', r.enabled ? 'translate-x-6' : 'translate-x-1')} />
                            {isBusy && <Loader2 className="absolute right-1 h-3 w-3 animate-spin text-white" />}
                          </button>
                          <span className={cn('inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide w-12 justify-end', r.enabled ? 'text-green-700' : 'text-gray-400')}>
                            {r.enabled ? <><Eye className="h-3 w-3" /> On</> : <><EyeOff className="h-3 w-3" /> Off</>}
                          </span>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </CardContent>
            )}
          </Card>
        )
      })}
    </div>
  )
}

// ─── Inline label editor ──────────────────────────────────────────────
function LabelEditor({
  initialLabel, initialDescription, onCancel, onSave,
}: {
  initialLabel: string
  initialDescription: string
  onCancel: () => void
  onSave: (label: string, description: string) => void
}) {
  const [label, setLabel] = useState(initialLabel)
  const [description, setDescription] = useState(initialDescription)

  return (
    <div className="space-y-1.5">
      <input
        autoFocus
        value={label}
        onChange={e => setLabel(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); onSave(label, description) }
          else if (e.key === 'Escape') { e.preventDefault(); onCancel() }
        }}
        maxLength={40}
        className="w-full text-sm font-medium border border-blue-300 bg-white rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-300"
        placeholder="Module name"
      />
      <input
        value={description}
        onChange={e => setDescription(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); onSave(label, description) }
          else if (e.key === 'Escape') { e.preventDefault(); onCancel() }
        }}
        maxLength={120}
        className="w-full text-xs text-gray-700 border border-blue-200 bg-white rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-300"
        placeholder="Short description (optional)"
      />
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => onSave(label, description)}
          className="inline-flex items-center gap-1 text-[11px] font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded px-2 py-0.5"
        >
          <Check className="h-3 w-3" /> Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-[11px] font-medium text-gray-500 hover:text-gray-800 px-2 py-0.5"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
