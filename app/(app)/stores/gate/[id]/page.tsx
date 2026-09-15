import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  loadEntry, loadItems, loadLists, listsOf, storableLocations, locationLabel, loadProjectOptions,
  loadRecentItemIds, loadLastLocations,
} from '@/lib/stores/queries'
import { createsStock } from '@/lib/stores/core'
import { CompleteForm } from './CompleteForm'
import { EntryDetailPanels } from './EntryDetailPanels'

export const dynamic = 'force-dynamic'

export default async function GateEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const entry = await loadEntry(id)
  if (!entry) notFound()

  const [lists, items, projects, recentItemIds, lastLocations] = await Promise.all([
    loadLists(),
    loadItems(),
    loadProjectOptions(),
    loadRecentItemIds(),
    loadLastLocations(),
  ])

  const locations = storableLocations(lists).map(l => ({
    id: l.id,
    label: locationLabel(lists, l.id) ?? l.name,
  }))

  return (
    <div className="space-y-5">
      <Link href="/stores/gate" className="inline-flex text-[12.5px] font-semibold text-indigo-700 hover:underline">
        ← Back to the register
      </Link>

      <EntryDetailPanels entry={entry} places={locations} />

      {entry.stage === 'gate' && entry.direction === 'in' && (
        <CompleteForm
          entryId={entry.id}
          entryNo={entry.no}
          register={entry.register}
          makesStock={createsStock(entry.register)}
          entities={listsOf(lists, 'entity').filter(e => e.isActive).map(e => ({ id: e.id, name: e.name, code: e.code }))}
          categories={listsOf(lists, 'item_category').filter(c => c.isActive).map(c => ({ id: c.id, name: c.name }))}
          locations={locations}
          projects={projects}
          items={items.filter(i => i.isActive).map(i => ({ id: i.id, name: i.name, unit: i.unit, lastRate: i.lastRate, in4MaterialId: i.in4MaterialId }))}
          recentItemIds={recentItemIds}
          gateParty={entry.partyName}
          gatePartyId={entry.in4PartyId}
          lastLocations={lastLocations}
        />
      )}
    </div>
  )
}
