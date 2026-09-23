import { createClient } from '@/lib/supabase/server'
import { RecycleBinList, type BinItem } from './RecycleBinList'

/** The recycle bin — the second half of Data › Deleted things (E1). Restore
 *  anything; nothing is removed automatically. The gate is the door's. */
export async function RecycleBinBody() {
  const supabase = await createClient()
  const { data: rows, error } = await supabase
    .from('recycle_bin')
    .select('id, entity_type, source_table, entity_id, label, context, module_slug, deleted_at, deleted_by')
    .is('restored_at', null)
    .order('deleted_at', { ascending: false })

  const items = (rows ?? []) as Omit<BinItem, 'deletedByName'>[]

  // Resolve deleter names in one lookup.
  const ids = [...new Set(items.map(i => i.deleted_by).filter(Boolean))] as string[]
  const namesById: Record<string, string> = {}
  if (ids.length) {
    const { data: profs } = await supabase.from('profiles').select('id, name, full_name, email').in('id', ids)
    for (const p of profs ?? []) namesById[p.id] = p.name || p.full_name || p.email || '—'
  }

  const withNames: BinItem[] = items.map(i => ({
    ...i,
    deletedByName: i.deleted_by ? (namesById[i.deleted_by] ?? null) : null,
  }))

  return <RecycleBinList items={withNames} error={error?.message ?? null} />
}
