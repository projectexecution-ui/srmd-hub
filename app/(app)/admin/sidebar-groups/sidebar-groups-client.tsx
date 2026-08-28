'use client'
// Editor for sidebar GROUPS. Create a named branch, tick the modules that
// belong under it, reorder or remove — saved to app_settings('sidebar_groups').
// A module can live in only one group; ticking it here moves it out of any other.
// Anything left unticked stays a top-level item in the side pane.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { SIDEBAR_GROUPS_KEY, type SidebarGroup } from '@/lib/sidebar-groups'
import { Folder, Plus, Trash2, ArrowUp, ArrowDown, Save, Check, Loader2, ListTree } from 'lucide-react'

type Mod = { slug: string; label: string }

function newId(): string {
  try { return crypto.randomUUID() } catch { return 'g_' + Math.random().toString(36).slice(2) + Date.now().toString(36) }
}

export default function SidebarGroupsClient({ initialGroups, modules }: { initialGroups: SidebarGroup[]; modules: Mod[] }) {
  const router = useRouter()
  const [groups, setGroups] = useState<SidebarGroup[]>(initialGroups)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const labelOf = (slug: string) => modules.find(m => m.slug === slug)?.label ?? slug
  const groupOfSlug = (slug: string) => groups.find(g => g.slugs.includes(slug))
  const ungrouped = modules.filter(m => !groupOfSlug(m.slug))

  const mutate = (fn: (gs: SidebarGroup[]) => SidebarGroup[]) => { setGroups(gs => fn(gs)); setDirty(true) }

  const addGroup = () => mutate(gs => [...gs, { id: newId(), name: 'New group', slugs: [] }])
  const rename = (id: string, name: string) => mutate(gs => gs.map(g => g.id === id ? { ...g, name } : g))
  const removeGroup = (id: string) => mutate(gs => gs.filter(g => g.id !== id))
  const move = (id: string, dir: -1 | 1) => mutate(gs => {
    const i = gs.findIndex(g => g.id === id); const j = i + dir
    if (i < 0 || j < 0 || j >= gs.length) return gs
    const copy = gs.slice();[copy[i], copy[j]] = [copy[j], copy[i]]; return copy
  })
  // Tick = put slug in THIS group (and pull it out of any other). Untick = free it.
  const toggleMember = (groupId: string, slug: string) => mutate(gs => gs.map(g => {
    if (g.id === groupId) {
      return g.slugs.includes(slug)
        ? { ...g, slugs: g.slugs.filter(s => s !== slug) }
        : { ...g, slugs: [...g.slugs, slug] }
    }
    return { ...g, slugs: g.slugs.filter(s => s !== slug) } // single membership
  }))

  async function save() {
    setSaving(true)
    const clean = groups
      .map(g => ({ id: g.id, name: g.name.trim(), slugs: g.slugs }))
      .filter(g => g.name.length > 0)
    const { error } = await createClient()
      .from('app_settings')
      .upsert({ key: SIDEBAR_GROUPS_KEY, value: JSON.stringify(clean) }, { onConflict: 'key' })
    setSaving(false)
    if (error) { toast.error(`Could not save: ${error.message}`); return }
    setDirty(false)
    toast.success('Sidebar groups saved — refresh any open tabs to see the new side pane.')
    router.refresh()
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <PageHeader title="Sidebar Groups" back="/admin"
        subtitle="Nest modules under a name of your choice — they show as a collapsible branch in the side pane.">
        <Button onClick={save} disabled={saving || !dirty} size="sm" className="gap-1.5">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {dirty ? 'Save changes' : 'Saved'}
        </Button>
      </PageHeader>

      <Card className="p-4 bg-slate-50/60 border-slate-200">
        <div className="flex gap-3">
          <div className="h-9 w-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0">
            <ListTree className="h-5 w-5" />
          </div>
          <div className="text-[13px] text-slate-700 leading-relaxed">
            Give a group a name, then tick the modules that belong under it. Grouped modules appear
            indented under a collapsible heading in the side pane; anything left <b>Ungrouped</b> stays
            at the top level. A module can be in only one group. Changes apply to everyone.
          </div>
        </div>
      </Card>

      {groups.length === 0 && (
        <Card className="p-8 text-center text-sm text-gray-500">
          No groups yet. Add one to start nesting modules in the side pane.
        </Card>
      )}

      {groups.map((g, gi) => (
        <Card key={g.id} className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Folder className="h-5 w-5 text-indigo-500 flex-shrink-0" />
            <Input value={g.name} onChange={e => rename(g.id, e.target.value)} placeholder="Group name"
              className="h-9 text-sm font-semibold max-w-xs" />
            <div className="ml-auto flex items-center gap-1">
              <button type="button" onClick={() => move(g.id, -1)} disabled={gi === 0}
                className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30" aria-label="Move up" title="Move up">
                <ArrowUp className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => move(g.id, 1)} disabled={gi === groups.length - 1}
                className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30" aria-label="Move down" title="Move down">
                <ArrowDown className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => removeGroup(g.id)}
                className="p-2 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50" aria-label="Delete group" title="Delete group (its modules become ungrouped)">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {modules.map(m => {
              const inThis = g.slugs.includes(m.slug)
              const other = groupOfSlug(m.slug)
              const inOther = other && other.id !== g.id
              return (
                <button key={m.slug} type="button" onClick={() => toggleMember(g.id, m.slug)}
                  className={cn('flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left text-[13px] min-h-[40px] transition-colors',
                    inThis ? 'border-indigo-300 bg-indigo-50 text-indigo-900'
                           : 'border-gray-200 bg-white hover:bg-gray-50 text-gray-700')}>
                  <span className={cn('h-4.5 w-4.5 flex-shrink-0 rounded border flex items-center justify-center',
                    inThis ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300 bg-white')} style={{ height: 18, width: 18 }}>
                    {inThis && <Check className="h-3 w-3 text-white" />}
                  </span>
                  <span className="truncate flex-1">{m.label}</span>
                  {inOther && <span className="text-[10.5px] text-gray-400 whitespace-nowrap">in “{other!.name}”</span>}
                </button>
              )
            })}
          </div>
        </Card>
      ))}

      <Button onClick={addGroup} variant="outline" className="gap-1.5">
        <Plus className="h-4 w-4" /> Add group
      </Button>

      {ungrouped.length > 0 && (
        <Card className="p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
            Ungrouped — stays at the top level ({ungrouped.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ungrouped.map(m => (
              <span key={m.slug} className="inline-flex items-center px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 text-[12px]">
                {m.label}
              </span>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
