// "Other-department approvals" — budget approved on this project that belongs
// to Design, Security, ICT and so on rather than to Construction.
//
// The Atm Head has always written this into his sign-off remark ("…approved by
// Maulikji under Design expense", "This is for Odoo expense"), where it could
// only be found by opening that one sheet. Tagged at sign-off, it now collects
// here, above the work categories.
//
// Only tagged approvals appear. A construction project shows nothing at all —
// an empty band would be a permanent reminder of an exception that never
// happens here.

import Link from 'next/link'
import { Building2 } from 'lucide-react'
import { formatINR, formatDate } from '@/lib/utils'

export interface DeptApproval {
  wsId: string
  wsCode: string | null
  dept: string
  note: string | null
  amount: number
  subLabel: string
  byName: string | null
  at: string | null
}

export function OtherDeptPanel({ records }: { records: DeptApproval[] }) {
  if (records.length === 0) return null

  const total = records.reduce((s, r) => s + r.amount, 0)

  return (
    <div className="rounded-xl border border-purple-200 bg-purple-50/50 overflow-hidden">
      <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-2.5 border-b border-purple-200">
        <p className="text-[13px] font-bold text-purple-900 inline-flex items-center gap-1.5">
          <Building2 className="h-4 w-4" /> Other-department approvals
        </p>
        <p className="text-[11.5px] text-purple-900/70 tabular-nums">
          {records.length} record{records.length === 1 ? '' : 's'} · {formatINR(total)}
        </p>
      </div>

      <div className="divide-y divide-purple-200">
        {records.map(r => (
          <div key={r.wsId} className="flex items-start justify-between gap-3 flex-wrap px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] text-gray-900">
                <span className="inline-block mr-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-purple-700 text-white align-middle">
                  {r.dept}
                </span>
                {r.subLabel}
              </p>
              {r.note && (
                <p className="mt-1 text-[12px] text-gray-700 whitespace-pre-line">{r.note}</p>
              )}
              <p className="mt-1 text-[11px] text-gray-500">
                {r.byName ?? '—'}
                {r.at && <> · {formatDate(r.at)}</>}
                {r.wsCode && (
                  <>
                    {' · '}
                    <Link href={`/cost-control/working-sheets/${r.wsId}`} className="text-blue-700 hover:underline">
                      {r.wsCode}
                    </Link>
                  </>
                )}
              </p>
            </div>
            <p className="text-[13px] font-bold tabular-nums text-gray-900 flex-shrink-0">
              {formatINR(r.amount)}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
