// Housekeeping — every place the masters disagree with themselves, on one
// page, each with where it gets fixed. The admin's morning list. Nothing is
// computed afresh: each line is a count the six Masters screens already
// make, gathered.

import { loadContactMaster, loadProjectMaster } from './masters-in4'
import { loadContacts as loadHubContacts, loadItems, loadStores, loadProjectMaster as loadHubRegistry, loadCategories } from '@/lib/masters'
import { todayIST } from '@/lib/utils'

export interface HousekeepingItem {
  key: string
  /** Who this is for. */
  hat: 'admin' | 'accounts' | 'head'
  what: string
  count: number
  /** Where the fix happens — 'IN4' or a CT Hub page. */
  fixIn: 'IN4' | 'CT Hub'
  href: string
  hint: string
}

export async function loadHousekeeping(): Promise<{ items: HousekeepingItem[]; open: number }> {
  const [contacts, hubContacts, itemsMaster, stores, registry, categories, projects] = await Promise.all([
    loadContactMaster(), loadHubContacts(), loadItems(), loadStores(), loadHubRegistry(), loadCategories(), loadProjectMaster(),
  ])
  const today = todayIST()
  const parties = [...contacts.consultants, ...contacts.vendors, ...contacts.contractors]
  const dupes = parties.filter(p => p.duplicateOf.length > 0)
  const wrongIds = parties.filter(p => p.gstinLooksWrong || p.panLooksWrong)
  const subs = projects.projects.flatMap(p => p.subs)
  const unlinkedSubs = subs.filter(x => x.isActive && x.workOrders > 0 && x.hubProjects.length === 0)
  const late = [
    ...projects.projects.filter(p => p.end && p.end < today && (p.status == null || p.status === 'Approved') && p.workOrders > 0),
    ...subs.filter(x => x.end && x.end < today && x.isActive && (x.status == null || x.status === 'Approved') && x.workOrders > 0),
  ]

  const items: HousekeepingItem[] = [
    { key: 'dupes', hat: 'admin', what: 'Contractors or suppliers entered twice in IN4', count: dupes.length, fixIn: 'IN4', href: '/masters/contacts?group=contractors', hint: dupes.slice(0, 4).map(p => p.name).join(', ') },
    { key: 'ids', hat: 'accounts', what: 'GSTIN or PAN in IN4 that cannot be right', count: wrongIds.length, fixIn: 'IN4', href: '/masters/contacts?group=vendors', hint: wrongIds.slice(0, 4).map(p => `${p.name} (${p.gstinLooksWrong ? p.gstin : p.pan})`).join(', ') },
    { key: 'hub-contacts', hat: 'admin', what: 'CT Hub contact names with no IN4 party behind them', count: hubContacts.hubOnly, fixIn: 'CT Hub', href: '/masters/contacts?group=hub-only', hint: 'Pin each to its IN4 party, or register it in IN4' },
    { key: 'hub-items', hat: 'admin', what: 'Warehouse items IN4 does not know', count: itemsMaster.hub.warehouse - itemsMaster.hub.warehouseMatched, fixIn: 'CT Hub', href: '/masters/items?view=hub', hint: 'Pin each to its IN4 material' },
    { key: 'hub-stores', hat: 'admin', what: 'CT Hub stores not in IN4 (cannot take an IN4 GRN)', count: stores.rows.filter(s => !s.in4Id).length, fixIn: 'CT Hub', href: '/masters/stores', hint: 'Pin each to its IN4 store' },
    { key: 'no-keeper', hat: 'admin', what: 'Warehouse stores with no keeper', count: stores.rows.filter(s => s.hubSources.includes('Warehouse') && !s.keeper).length, fixIn: 'CT Hub', href: '/warehouse/settings', hint: 'Set the keeper under Warehouse settings' },
    { key: 'unmapped', hat: 'admin', what: 'Active IN4 sub-projects mapped to no CT Hub project', count: registry.in4Unmapped.length, fixIn: 'CT Hub', href: '/masters/mapping', hint: registry.in4Unmapped.slice(0, 4).map(x => x.name).join(', ') },
    { key: 'unlinked-wos', hat: 'admin', what: 'IN4 sub-projects with work orders that feed no CT Hub project', count: unlinkedSubs.length, fixIn: 'CT Hub', href: '/masters/projects', hint: unlinkedSubs.slice(0, 4).map(x => x.name).join(', ') },
    { key: 'no-area', hat: 'admin', what: 'CT Hub projects with no built-up area (₹/sft blank)', count: registry.rows.filter(r => !r.builtUpSft).length, fixIn: 'CT Hub', href: '/masters/projects?view=hub', hint: `${registry.rows.filter(r => !r.builtUpSft && r.in4?.areaFt).length} can take IN4’s area in one click` },
    { key: 'no-in4', hat: 'admin', what: 'CT Hub projects linked to no IN4 sub-project', count: registry.rows.filter(r => !r.in4).length, fixIn: 'CT Hub', href: '/masters/mapping', hint: 'Their Budget, WO/PO and Indents tabs stay empty until linked' },
    { key: 'cat-differs', hat: 'admin', what: 'Category codes that mean different things in CT Hub and IN4', count: categories.rows.filter(c => c.state === 'name-differs').length, fixIn: 'CT Hub', href: '/masters/categories?view=hub', hint: 'The budget sync merges on these codes' },
    { key: 'cat-dup', hat: 'admin', what: 'Category codes IN4 uses twice', count: categories.rows.filter(c => c.in4Duplicates).length, fixIn: 'IN4', href: '/masters/categories?view=hub', hint: categories.rows.filter(c => c.in4Duplicates).map(c => c.code).join(', ') },
    { key: 'late', hat: 'head', what: 'Active projects or sub-projects past their IN4 end date', count: late.length, fixIn: 'IN4', href: '/masters/projects', hint: late.slice(0, 4).map(x => x.name).join(', ') },
    { key: 'inactive-parties', hat: 'head', what: 'Contractors/suppliers marked inactive in IN4 but still on orders', count: parties.filter(p => !p.isActive).length, fixIn: 'IN4', href: '/masters/contacts?group=contractors', hint: 'Shown greyed on the Contacts screen' },
  ]
  return { items, open: items.filter(i => i.count > 0).length }
}
