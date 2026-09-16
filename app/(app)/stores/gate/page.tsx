import Link from 'next/link'
import {
  loadEntries, loadLists, listsOf, loadRecentParties, loadSuppliers,
} from '@/lib/stores/queries'
import { fmtQty, canRecordAtGate, type Stage } from '@/lib/stores/core'
import { getMyProfile } from '@/lib/auth'
import { Section, Empty, Scroller, th, thNum, td, tdNum, StageChip, RegisterChip, When } from '../ui'
import { GateInForm, StorekeeperCta } from './GateInForm'

export const dynamic = 'force-dynamic'

const WAYS: Array<{ key: 'in' | 'out' | null; label: string }> = [
  { key: null,  label: 'In and out' },
  { key: 'in',  label: 'In' },
  { key: 'out', label: 'Out' },
]

/** Keep whichever filter the reader did not just click. */
function gateHref(stage: Stage | 'all', way: 'in' | 'out' | null): string {
  const q = new URLSearchParams()
  if (stage !== 'gate') q.set('stage', stage)
  if (way) q.set('direction', way)
  const s = q.toString()
  return s ? `/stores/gate?${s}` : '/stores/gate'
}

const STAGES: Array<{ key: Stage | 'all'; label: string }> = [
  { key: 'gate',     label: 'Waiting on storekeeper' },
  { key: 'complete', label: 'Complete' },
  { key: 'all',      label: 'Everything' },
]

export default async function GatePage({
  searchParams,
}: { searchParams: Promise<{ stage?: string; direction?: string }> }) {
  const { stage, direction } = await searchParams
  const active = (STAGES.find(s => s.key === stage)?.key ?? 'gate') as Stage | 'all'
  const way: 'in' | 'out' | null =
    direction === 'in' ? 'in' : direction === 'out' ? 'out' : null

  const [entries, lists, recent, waiting, suppliers] = await Promise.all([
    loadEntries({ stage: active === 'all' ? null : active, direction: way, limit: 200 }),
    loadLists(),
    loadRecentParties(),
    loadEntries({ stage: 'gate', limit: 200 }),
    loadSuppliers(),
  ])
  const modes = listsOf(lists, 'delivery_mode').filter(m => m.isActive)

  // Security's door, and the storekeeper's when Security is not there.
  const profile = await getMyProfile()
  const mayRecord = canRecordAtGate(profile?.role)

  return (
    <div className="space-y-6">
      {/* The guard's door and the storekeeper's door, side by side and equal —
          they are two different people arriving at the same screen. */}
      <div className="grid gap-3 sm:grid-cols-2">
        {mayRecord && (
          <GateInForm
            modes={modes.map(m => ({ id: m.id, name: m.name }))}
            recentParties={recent}
            suppliers={suppliers}
          />
        )}
        <StorekeeperCta waiting={waiting.length} />
      </div>

      <Section title="The register" note="Every vehicle through the gate, newest first">
        <div className="flex flex-wrap items-center gap-1.5">
          {STAGES.map(s => (
            <Link
              key={s.key}
              href={gateHref(s.key, way)}
              className={`rounded-lg px-3 py-2 text-[12.5px] font-semibold min-h-[44px] inline-flex items-center ${
                active === s.key ? 'bg-indigo-700 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {s.label}
            </Link>
          ))}

          {/* In and out are two different questions, so they filter separately
              rather than being read off a prefix on the number. */}
          <span className="mx-1 h-6 w-px bg-gray-200" aria-hidden />
          {WAYS.map(w => (
            <Link
              key={w.key ?? 'both'}
              href={gateHref(active, w.key)}
              className={`rounded-lg px-3 py-2 text-[12.5px] font-semibold min-h-[44px] inline-flex items-center ${
                way === w.key ? 'bg-gray-900 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {w.label}
            </Link>
          ))}
        </div>

        {entries.length === 0 ? (
          <Empty
            title={active === 'gate' ? 'Nothing is waiting on the storekeeper' : 'Nothing here yet'}
            hint={active === 'gate'
              ? 'Entries appear here the moment Security saves one, and leave it once the storekeeper has counted the material in.'
              : 'Record a vehicle above and it will show here.'}
          />
        ) : (
          <Scroller min={860}>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={th}>Number</th>
                  <th className={th}>Register</th>
                  <th className={th}>Party</th>
                  <th className={th}>Vehicle / driver</th>
                  <th className={th}>Project</th>
                  <th className={thNum}>Lines</th>
                  <th className={th}>Stage</th>
                  <th className={th}>Recorded</th>
                  <th className={th}></th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.id} className={e.stage === 'void' ? 'opacity-50' : ''}>
                    <td className={td}>
                      <Link href={`/stores/gate/${e.id}`} className="font-mono text-[12.5px] font-semibold text-indigo-700 hover:underline">
                        {e.no}
                      </Link>
                      {e.linkedNo && <p className="text-[11px] text-gray-400 font-mono">({e.linkedNo})</p>}
                    </td>
                    <td className={td}><RegisterChip register={e.register} /></td>
                    <td className={td}>{e.partyName ?? <span className="text-gray-400">—</span>}</td>
                    <td className={td}>
                      <span className="font-mono text-[12px]">{e.vehicleNo ?? '—'}</span>
                      {e.driverName && <p className="text-[11.5px] text-gray-500">{e.driverName}</p>}
                    </td>
                    <td className={td}>{e.projectName ?? <span className="text-gray-400">not set</span>}</td>
                    <td className={tdNum}>{e.lineCount ? `${e.lineCount} · ${fmtQty(e.totalQty)}` : '—'}</td>
                    <td className={td}><StageChip stage={e.stage} /></td>
                    <td className={td}>
                      <When at={e.entryAt} />
                      {e.createdByName && <p className="text-[11px] text-gray-400">{e.createdByName}</p>}
                    </td>
                    <td className={td}>
                      {e.stage === 'gate' && (
                        <Link href={`/stores/gate/${e.id}`} className="text-[12px] font-semibold text-indigo-700 hover:underline whitespace-nowrap">
                          Complete →
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroller>
        )}
      </Section>
    </div>
  )
}
