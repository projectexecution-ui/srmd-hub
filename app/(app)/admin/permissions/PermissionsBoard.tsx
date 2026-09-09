'use client'
import { useState, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'
import PermissionsMatrix, { type PermRow } from './PermissionsMatrix'
import type { Role } from '@/lib/types'
import type { RoleLabelMap } from '@/lib/role-labels'
import { filterRows, type MatrixSection } from '@/lib/revamp/permissions'

export default function PermissionsBoard({ sections, roles, roleLabels, currentUserIsPortalOwner, canManageRoles, accessInitial }: {
  sections: MatrixSection[]
  roles: readonly Role[]
  roleLabels: RoleLabelMap
  currentUserIsPortalOwner: boolean
  canManageRoles: boolean
  accessInitial: PermRow[]
}) {
  const [q, setQ] = useState('')

  // A search narrows every section; a tab keeps its pills and a pill keeps its tab.
  const shown = useMemo(() => sections.map(s => ({ ...s, rows: filterRows(s.rows, q) })).filter(s => s.rows.length > 0), [q, sections])

  return (
    <div className="space-y-4">
      <div className="relative max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search a tab, a pill or a power…" className="pl-8" />
      </div>

      {shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-500">Nothing matches “{q}”.</div>
      ) : (
        <PermissionsMatrix
          sections={shown}
          searching={q.trim().length > 0}
          roles={roles}
          initial={accessInitial}
          roleLabels={roleLabels}
          currentUserIsPortalOwner={currentUserIsPortalOwner}
          canManageRoles={canManageRoles}
          totalModules={sections.flatMap(s => s.rows).filter(r => r.kind === 'module').length}
        />
      )}
    </div>
  )
}
