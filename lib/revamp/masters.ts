// The Masters layer — the lists everything else in the hub points at.
//
// The HOD's complaint was "it's all scattered". The audit found exactly how
// scattered: FOUR separate item lists, FOUR contact lists, TWO store lists, and
// three different screens that create a project. Masters is the fix, and the
// first job of these screens is to SHOW the duplication rather than quietly
// paper over it — you cannot merge lists you cannot see.
//
// Nothing here writes. Merging is a decision Aksha makes with the numbers in
// front of him, not something a migration should do on its own.

import { createClient } from '@/lib/supabase/server'

export interface MasterSummary {
  key: string
  label: string
  /** One line a non-technical reader understands. */
  hint: string
  /** Total distinct records across every list that holds this thing. */
  total: number
  /** The lists it currently lives in. More than one = the scattering. */
  sources: Array<{ name: string; count: number; note?: string }>
  built: boolean
  href: string | null
}

/** Normalise a name for comparison: case, spacing and punctuation differ
 *  between IN4 exports and what people typed into the hub. */
export function nameKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export interface ContactRow {
  name: string
  gstin: string | null
  phone: string | null
  email: string | null
  address: string | null
  /** Which list(s) this name appears in. */
  sources: string[]
  /** How many of the five useful fields are filled. */
  completeness: number
}

const CONTACT_FIELDS = 5 // gstin, phone, email, address, and the name itself

export async function loadContacts(): Promise<ContactRow[]> {
  const supabase = await createClient()
  const [vRes, jRes] = await Promise.all([
    supabase.from('vendors').select('name, gstin, address, contact_phone, contact_email'),
    supabase.from('jmr_contractors').select('name, gst_number, phone, email'),
  ])

  const byKey = new Map<string, ContactRow>()
  const put = (row: Omit<ContactRow, 'sources' | 'completeness'>, source: string) => {
    const k = nameKey(row.name)
    if (!k) return
    const existing = byKey.get(k)
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source)
      // Keep the richer value when the same contact sits in two lists.
      existing.gstin ??= row.gstin
      existing.phone ??= row.phone
      existing.email ??= row.email
      existing.address ??= row.address
      return
    }
    byKey.set(k, { ...row, sources: [source], completeness: 0 })
  }

  for (const v of (vRes.data ?? []) as Array<Record<string, unknown>>) {
    put({
      name: String(v.name ?? '').trim(),
      gstin: (v.gstin as string | null) || null,
      phone: (v.contact_phone as string | null) || null,
      email: (v.contact_email as string | null) || null,
      address: (v.address as string | null) || null,
    }, 'Vendors')
  }
  for (const c of (jRes.data ?? []) as Array<Record<string, unknown>>) {
    put({
      name: String(c.name ?? '').trim(),
      gstin: (c.gst_number as string | null) || null,
      phone: (c.phone as string | null) || null,
      email: (c.email as string | null) || null,
      address: null,
    }, 'JMR contractors')
  }

  const rows = [...byKey.values()]
  for (const r of rows) {
    r.completeness = Math.round(
      ([r.name, r.gstin, r.phone, r.email, r.address].filter(Boolean).length / CONTACT_FIELDS) * 100,
    )
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

export interface ItemListSummary {
  name: string
  count: number
  note: string
}

export async function loadItemLists(): Promise<ItemListSummary[]> {
  const supabase = await createClient()
  const count = async (table: string) => {
    const { count: n } = await supabase.from(table).select('id', { count: 'exact', head: true })
    return n ?? 0
  }

  const [wh, est, inv, jmr] = await Promise.all([
    count('wh_items'),
    count('est_subcategories'),
    count('inv_items'),
    count('jmr_items'),
  ])

  return [
    { name: 'Warehouse items', count: wh,  note: 'The biggest list — built from the IN4 uploads' },
    { name: 'Established Rates sub-categories', count: est, note: 'The rate library’s own taxonomy' },
    { name: 'Inventory items (old)', count: inv, note: 'From the module Warehouse V2 replaced' },
    { name: 'JMR items', count: jmr, note: 'Machine and manpower types only' },
  ]
}

export async function loadMasterSummaries(): Promise<MasterSummary[]> {
  const supabase = await createClient()

  const [contacts, itemLists, storeRes, invWhRes, projRes] = await Promise.all([
    loadContacts(),
    loadItemLists(),
    supabase.from('wh_locations').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    supabase.from('inv_warehouses').select('id', { count: 'exact', head: true }),
    supabase.from('projects').select('id', { count: 'exact', head: true }).is('archived_at', null),
  ])

  const contactSources = new Map<string, number>()
  for (const c of contacts) for (const s of c.sources) contactSources.set(s, (contactSources.get(s) ?? 0) + 1)

  return [
    {
      key: 'contacts', label: 'Contacts', built: true, href: '/masters/contacts',
      hint: 'Contractors, suppliers and consultants — one list instead of four',
      total: contacts.length,
      sources: [...contactSources.entries()].map(([name, count]) => ({ name, count })),
    },
    {
      key: 'items', label: 'Items', built: true, href: '/masters/items',
      hint: 'Materials — the same cement sits in four separate lists today',
      total: itemLists.reduce((s, l) => s + l.count, 0),
      sources: itemLists.map(l => ({ name: l.name, count: l.count, note: l.note })),
    },
    {
      key: 'stores', label: 'Stores', built: false, href: null,
      hint: 'Physical stores — two lists, from two different modules',
      total: (storeRes.count ?? 0) + (invWhRes.count ?? 0),
      sources: [
        { name: 'Warehouse locations', count: storeRes.count ?? 0 },
        { name: 'Inventory warehouses (old)', count: invWhRes.count ?? 0 },
      ],
    },
    {
      key: 'trusts', label: 'Trusts', built: false, href: null,
      hint: 'Recoverable from the WO number in every IN4 export — nothing to type',
      total: 0,
      sources: [{ name: 'No trust list exists yet', count: 0, note: 'Read it from WO/<TRUST>/… instead' }],
    },
    {
      key: 'projects', label: 'Projects', built: false, href: null,
      hint: 'One registry — three different screens create into it today',
      total: projRes.count ?? 0,
      sources: [{ name: 'projects', count: projRes.count ?? 0, note: 'Created from 3 different forms' }],
    },
  ]
}
