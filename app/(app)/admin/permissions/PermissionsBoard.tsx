'use client'
import { useState, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'
import PermissionsMatrix, { type PermRow } from './PermissionsMatrix'
import type { Role } from '@/lib/types'
import type { RoleLabelMap } from '@/lib/role-labels'

export default function PermissionsBoard({ modules, roles, roleLabels, currentUserIsPortalOwner, canManageRoles, accessInitial }: {
  modules: { slug: string; label: string }[]
  roles: readonly Role[]
  roleLabels: RoleLabelMap
  currentUserIsPortalOwner: boolean
  canManageRoles: boolean
  accessInitial: PermRow[]
}) {
  const [q, setQ] = useState('')

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return modules
    return modules.filter(m => m.label.toLowerCase().includes(s) || m.slug.toLowerCase().includes(s))
  }, [q, modules])

  return (
    <div className="space-y-4">
      <div className="relative max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search modules…" className="pl-8" />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-500">No modules match “{q}”.</div>
      ) : (
        <PermissionsMatrix
          modules={filtered}
          roles={roles}
          initial={accessInitial}
          roleLabels={roleLabels}
          currentUserIsPortalOwner={currentUserIsPortalOwner}
          canManageRoles={canManageRoles}
          totalModules={modules.length}
        />
      )}
    </div>
  )
}
