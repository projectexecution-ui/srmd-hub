'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Loader2, Check, Eye, EyeOff, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'
import { confirm } from '@/components/ui/confirm-dialog'

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
  const router = useRouter()
  const [groups, setGroups] = useState(initialGroups)
  const [busy, setBusy] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editingSlug, setEditingSlug] = useState<string | null>(null)

  async function toggle(row: ModuleRow) {
    const slug = row.slug
    // Turning a module OFF hides it for the whole team — confirm first, since
    // a stray tap could hide something like Indents or Invoices for everyone.
    if (row.enabled) {
      const ok = await confirm({
        title: `Hide “${row.label}” from everyone?`,
        message: `It will disappear from the dashboard and sidebar for the whole team. Portal Owners still see it, and you can turn it back on here anytime.`,
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
    const { error } = await supabase
      .from('module_visibility')
      .upsert({ slug, enabled: nextValue }, { onConflict: 'slug' })
    setBusy(null)
    if (error) {
      setGroups(prev)
      setError(`${slug}: ${error.message}`)
      return
    }
    setSaved(slug)
    setTimeout(() => setSaved(s => (s === slug ? null : s)), 1500)
    router.refresh()
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
      {groups.map(g => {
        const visibleCount = g.rows.filter(r => r.enabled).length
        return (
          <Card key={g.title}>
            <CardContent className="pt-5">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-sm font-bold uppercase tracking-wide text-gray-700">{g.title}</h3>
                <span className="text-xs text-gray-500"><b>{visibleCount}</b> of {g.rows.length} visible</span>
              </div>
              <ul className="divide-y divide-gray-100">
                {g.rows.map(r => {
                  const isBusy = busy === r.slug
                  const isSaved = saved === r.slug
                  return (
                    <li key={r.slug} className="flex items-center justify-between gap-3 py-3">
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
                              <span className="font-medium text-gray-900">{r.label}</span>
                              <span className="text-[11px] font-mono text-gray-400">{r.slug}</span>
                              {canRename && (
                                <button
                                  type="button"
                                  onClick={() => setEditingSlug(r.slug)}
                                  className="text-gray-300 hover:text-blue-600"
                                  title="Rename module"
                                >
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
                          <span className="text-[11px] text-green-700 font-semibold inline-flex items-center gap-0.5">
                            <Check className="h-3 w-3" /> saved
                          </span>
                        )}
                        <button
                          onClick={() => toggle(r)}
                          disabled={isBusy}
                          title={r.enabled ? 'Click to hide from everyone' : 'Click to show to everyone'}
                          className={cn(
                            'relative inline-flex h-7 w-12 items-center rounded-full transition-colors',
                            r.enabled ? 'bg-green-500' : 'bg-gray-300',
                            isBusy && 'opacity-60 cursor-wait',
                          )}
                        >
                          <span
                            className={cn(
                              'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                              r.enabled ? 'translate-x-6' : 'translate-x-1',
                            )}
                          />
                          {isBusy && (
                            <Loader2 className="absolute right-1 h-3 w-3 animate-spin text-white" />
                          )}
                        </button>
                        <span className={cn(
                          'inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide w-12 justify-end',
                          r.enabled ? 'text-green-700' : 'text-gray-400',
                        )}>
                          {r.enabled ? <><Eye className="h-3 w-3" /> On</> : <><EyeOff className="h-3 w-3" /> Off</>}
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </CardContent>
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
