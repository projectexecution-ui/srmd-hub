'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/PageHeader'
import {
  Users, Search, UserCheck, UserX, Mail, Shield, Copy, Check, Send, Crown, Trash2,
  UserPlus, Loader2, Plus, X, ChevronDown, ChevronRight, Layers, Ban,
  Settings2, Info, EyeOff, Clock, ThumbsDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Profile, Role } from '@/lib/types'
import { ALL_ROLES } from '@/lib/types'
import type { RoleLabelMap } from '@/lib/role-labels'
import { MODULES } from '@/lib/modules'
import { confirm } from '@/components/ui/confirm-dialog'
import { isPendingAccessRequest, allowedEmailSet } from '@/lib/access-requests'

const ROLES: Role[] = ALL_ROLES

// Modules that have per-user role overrides on offer. Excludes external
// links and pure-admin slugs (those are role-blind in this UI).
const OVERRIDABLE_MODULES = MODULES
  .filter(m => !m.external)
  .filter(m => !m.slug.startsWith('admin-'))
  .map(m => ({ slug: m.slug, label: m.label }))

interface AllowedEmail {
  email: string
  role: Role
  added_by: string | null
  added_at: string
  notes: string | null
}

interface UserModuleRole {
  user_id: string
  module_slug: string
  role: Role
  granted_at: string
  notes: string | null
}

interface UserModuleBlock {
  user_id: string
  module_slug: string
  blocked_by: string | null
  blocked_at: string
  reason: string | null
}

export default function UsersClient({
  initialUsers, initialAllowedEmails, initialModuleRoles, initialModuleBlocks,
  currentUserId, currentUserIsPortalOwner, roleLabels, adminEmail,
}: {
  initialUsers: Profile[]
  initialAllowedEmails: AllowedEmail[]
  initialModuleRoles: UserModuleRole[]
  initialModuleBlocks: UserModuleBlock[]
  currentUserId: string
  currentUserIsPortalOwner: boolean
  roleLabels: RoleLabelMap
  adminEmail: string | null
}) {
  const supabase = createClient()
  const [users, setUsers] = useState<Profile[]>(initialUsers)
  const [allowed, setAllowed] = useState<AllowedEmail[]>(initialAllowedEmails)
  const [moduleRoles, setModuleRoles] = useState<UserModuleRole[]>(initialModuleRoles)
  const [moduleBlocks, setModuleBlocks] = useState<UserModuleBlock[]>(initialModuleBlocks)
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  // Status filter chip — drives the table contents
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'admins' | 'portal_owners'>('all')
  // Anonymous quick-signin profiles hide by default — admin can opt in.
  const [showAnonymous, setShowAnonymous] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // New-allowed-email form state
  const [newEmail, setNewEmail] = useState('')
  const [newRole, setNewRole]   = useState<Role>('viewer')
  const [adding, setAdding]     = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  // ID of the user whose delete is currently armed (one click → armed,
  // second click within 5s → actually deletes). Null = not armed.
  const [deleteArmed, setDeleteArmed] = useState<string | null>(null)
  // Per-pending-request role choice (defaults to viewer). Keyed by profile id.
  const [requestRole, setRequestRole] = useState<Record<string, Role>>({})

  // Detect quick-signin / anonymous accounts so admin can hide them.
  // Pattern: email starts with anon- and ends with @srmd.local
  const isAnonymous = (u: Profile) => /^anon-/i.test(u.email) && /@srmd\.local$/i.test(u.email)

  const filtered = users.filter(u => {
    // Status chip
    if (statusFilter === 'active' && !u.is_active) return false
    if (statusFilter === 'inactive' && u.is_active) return false
    if (statusFilter === 'admins' && u.role !== 'admin') return false
    if (statusFilter === 'portal_owners' && !u.is_portal_owner) return false
    // Hide anonymous unless explicitly opted in
    if (!showAnonymous && isAnonymous(u)) return false
    // Free-text search
    const q = search.toLowerCase()
    if (!q) return true
    return (
      (u.name?.toLowerCase().includes(q) ?? false) ||
      (u.full_name?.toLowerCase().includes(q) ?? false) ||
      u.email.toLowerCase().includes(q)
    )
  })

  const activeCount = users.filter(u => u.is_active).length
  const adminCount = users.filter(u => u.role === 'admin').length
  const uploaderCount = users.filter(u => u.role === 'uploader').length
  const portalOwnerCount = users.filter(u => u.is_portal_owner).length
  const anonymousCount = users.filter(isAnonymous).length

  // ─── Pending access requests ───────────────────────────────
  // People who signed in via the public link but aren't allowlisted yet, and
  // haven't been approved/denied. Newest first.
  const allowedSet = allowedEmailSet(allowed)
  const pendingRequests = users
    .filter(u => isPendingAccessRequest(u, allowedSet, adminEmail))
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))

  async function updateRole(u: Profile, next: Role) {
    setBusyId(u.id); setError(null)
    const { error } = await supabase.from('profiles').update({ role: next }).eq('id', u.id)
    setBusyId(null)
    if (error) { setError(error.message); return }
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, role: next } : x))
  }

  async function toggleActive(u: Profile) {
    setBusyId(u.id); setError(null)
    const next = !u.is_active
    const { error } = await supabase.from('profiles').update({ is_active: next }).eq('id', u.id)
    setBusyId(null)
    if (error) { setError(error.message); return }
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_active: next } : x))
  }

  async function deleteUser(u: Profile) {
    if (!currentUserIsPortalOwner) {
      setError('Only a Portal Owner can delete users.')
      return
    }
    if (u.is_active) {
      setError('Deactivate the user first, then delete.')
      return
    }
    setBusyId(u.id); setError(null)
    const { data, error: rpcErr } = await supabase.rpc('delete_user_account', { target_id: u.id })
    setBusyId(null)
    setDeleteArmed(null)
    if (rpcErr) {
      // Surface the friendly raise-exception message
      setError(rpcErr.message || 'Could not delete user')
      return
    }
    if (data && typeof data === 'object' && 'ok' in data && data.ok === true) {
      setUsers(prev => prev.filter(x => x.id !== u.id))
    } else {
      setError('Delete returned an unexpected response')
    }
  }

  function armDelete(userId: string) {
    setError(null)
    setDeleteArmed(userId)
    // Auto-disarm after 5s so the button doesn't stay "Confirm" forever
    setTimeout(() => {
      setDeleteArmed(curr => (curr === userId ? null : curr))
    }, 5000)
  }

  async function togglePortalOwner(u: Profile) {
    if (!currentUserIsPortalOwner) {
      setError('Only an existing Portal Owner can promote or demote Portal Owners.')
      return
    }
    if (u.role !== 'admin') {
      setError('Only admins can be Portal Owners. Change the role to admin first.')
      return
    }
    setBusyId(u.id); setError(null)
    const next = !u.is_portal_owner
    const { error } = await supabase.from('profiles').update({ is_portal_owner: next }).eq('id', u.id)
    setBusyId(null)
    if (error) {
      // The DB trigger refuses removal of the last Portal Owner — surface a friendly message.
      const friendly = error.message?.includes('last Portal Owner')
        ? 'Cannot remove the last Portal Owner. Promote another admin first.'
        : error.message
      setError(friendly)
      return
    }
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_portal_owner: next } : x))
  }

  async function copyInviteLink() {
    const url = typeof window !== 'undefined' ? window.location.origin : 'https://srmd-hub.vercel.app'
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  async function addAllowedEmail(e?: React.FormEvent) {
    e?.preventDefault()
    const email = newEmail.trim().toLowerCase()
    if (!email) return
    if (!email.includes('@') || !email.includes('.')) {
      setError('Enter a valid email address')
      return
    }
    setAdding(true); setError(null)
    const { data, error } = await supabase
      .from('allowed_emails')
      .upsert({ email, role: newRole }, { onConflict: 'email' })
      .select('*')
      .single()
    setAdding(false)
    if (error) { setError(error.message); return }
    setAllowed(prev => {
      const filtered = prev.filter(a => a.email !== email)
      return [data as AllowedEmail, ...filtered]
    })
    setNewEmail(''); setNewRole('viewer')
  }

  async function removeAllowedEmail(email: string) {
    if (!(await confirm(`Remove ${email} from the allowlist? They will be blocked on next sign-in (existing active profiles are NOT removed by this).`))) return
    setRemoving(email); setError(null)
    const { error } = await supabase.from('allowed_emails').delete().eq('email', email)
    setRemoving(null)
    if (error) { setError(error.message); return }
    setAllowed(prev => prev.filter(a => a.email !== email))
  }

  // ─── Per-module role overrides ────────────────────────────
  function rolesFor(userId: string): UserModuleRole[] {
    return moduleRoles.filter(r => r.user_id === userId)
  }

  async function setUserModuleRole(userId: string, moduleSlug: string, role: Role) {
    setBusyId(`umr:${userId}:${moduleSlug}`); setError(null)
    const { data, error } = await supabase
      .from('user_module_roles')
      .upsert({ user_id: userId, module_slug: moduleSlug, role }, { onConflict: 'user_id,module_slug' })
      .select('*')
      .single()
    setBusyId(null)
    if (error) { setError(error.message); return }
    setModuleRoles(prev => {
      const others = prev.filter(r => !(r.user_id === userId && r.module_slug === moduleSlug))
      return [...others, data as UserModuleRole]
    })
  }

  async function removeUserModuleRole(userId: string, moduleSlug: string) {
    setBusyId(`umr:${userId}:${moduleSlug}`); setError(null)
    const { error } = await supabase
      .from('user_module_roles')
      .delete()
      .eq('user_id', userId)
      .eq('module_slug', moduleSlug)
    setBusyId(null)
    if (error) { setError(error.message); return }
    setModuleRoles(prev => prev.filter(r => !(r.user_id === userId && r.module_slug === moduleSlug)))
  }

  // ─── Per-user module BLOCKS ────────────────────────────
  function blocksFor(userId: string): UserModuleBlock[] {
    return moduleBlocks.filter(b => b.user_id === userId)
  }

  async function blockUserModule(userId: string, moduleSlug: string) {
    setBusyId(`umb:${userId}:${moduleSlug}`); setError(null)
    const { data, error } = await supabase
      .from('user_module_blocks')
      .upsert({ user_id: userId, module_slug: moduleSlug }, { onConflict: 'user_id,module_slug' })
      .select('*')
      .single()
    setBusyId(null)
    if (error) { setError(error.message); return }
    setModuleBlocks(prev => {
      const others = prev.filter(b => !(b.user_id === userId && b.module_slug === moduleSlug))
      return [...others, data as UserModuleBlock]
    })
  }

  async function unblockUserModule(userId: string, moduleSlug: string) {
    setBusyId(`umb:${userId}:${moduleSlug}`); setError(null)
    const { error } = await supabase
      .from('user_module_blocks')
      .delete()
      .eq('user_id', userId)
      .eq('module_slug', moduleSlug)
    setBusyId(null)
    if (error) { setError(error.message); return }
    setModuleBlocks(prev => prev.filter(b => !(b.user_id === userId && b.module_slug === moduleSlug)))
  }

  async function updateAllowedRole(email: string, role: Role) {
    setRemoving(email); setError(null)
    // 1) Update the allowlist row (seed role for future sign-ins)
    const { error: allowErr } = await supabase.from('allowed_emails').update({ role }).eq('email', email)
    if (allowErr) { setRemoving(null); setError(allowErr.message); return }
    setAllowed(prev => prev.map(a => a.email === email ? { ...a, role } : a))

    // 2) If a profile already exists for this email, sync its LIVE role too.
    //    Without this, admins changing the dropdown see no effect on the signed-in
    //    user — the source of constant "RLS rejected my insert" confusion.
    //    profiles.email is text + we lowercase for safety.
    const target = email.toLowerCase().trim()
    const { error: profErr } = await supabase
      .from('profiles')
      .update({ role })
      .eq('email', target)
    setRemoving(null)
    if (profErr) { setError(`Allowlist updated, but failed to sync profile: ${profErr.message}`); return }
    // Reflect in local UI state too so the Users list above shows the new role immediately.
    setUsers(prev => prev.map(u =>
      (u.email?.toLowerCase() === target) ? { ...u, role } : u
    ))
  }

  // ─── Approve / deny self-service access requests ──────────────
  async function approveRequest(u: Profile) {
    const role = requestRole[u.id] ?? 'viewer'
    const email = (u.email ?? '').toLowerCase().trim()
    setBusyId(`req:${u.id}`); setError(null)
    // 1) Add to the allowlist so future sign-ins stay clean + auditable.
    const { data: allowedRow, error: allowErr } = await supabase
      .from('allowed_emails')
      .upsert({ email, role }, { onConflict: 'email' })
      .select('*')
      .single()
    if (allowErr) { setBusyId(null); setError(allowErr.message); return }
    // 2) Activate the profile with the chosen role and clear the pending marker.
    const { error: profErr } = await supabase
      .from('profiles')
      .update({ role, is_active: true, access_state: 'approved' })
      .eq('id', u.id)
    setBusyId(null)
    if (profErr) { setError(profErr.message); return }
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, role, is_active: true, access_state: 'approved' } : x))
    setAllowed(prev => [allowedRow as AllowedEmail, ...prev.filter(a => a.email !== email)])
  }

  async function denyRequest(u: Profile) {
    if (!(await confirm(`Deny access for ${u.name || u.full_name || u.email}? They'll stay signed out. You can still approve them later from this list.`))) return
    setBusyId(`req:${u.id}`); setError(null)
    const { error } = await supabase
      .from('profiles')
      .update({ access_state: 'denied', is_active: false })
      .eq('id', u.id)
    setBusyId(null)
    if (error) { setError(error.message); return }
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, access_state: 'denied', is_active: false } : x))
  }

  const totalUsers = users.length

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader
        title="Users & Permissions"
        back="/admin"
        subtitle="Active accounts, their roles, and per-user access controls."
      >
        <Button onClick={copyInviteLink} variant="outline" size="sm">
          {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Copied' : 'Copy invite link'}
        </Button>
      </PageHeader>

      {error && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}

      {/* ─── Pending access requests ─────────────────────────────────────
          People who signed in via the shared link but aren't allowlisted.
          Approve (pick a role) or deny — no need to pre-add their email.
          Always shown (even when empty) so the feature is discoverable. */}
      <Card className={cn(pendingRequests.length > 0 ? 'border-amber-300 bg-amber-50/60' : 'border-gray-200')}>
        <CardHeader>
          <CardTitle className={cn('flex items-center gap-2 text-base', pendingRequests.length > 0 ? 'text-amber-900' : 'text-gray-700')}>
            <span className="relative inline-flex">
              <Clock className={cn('h-5 w-5', pendingRequests.length > 0 ? 'text-amber-600' : 'text-gray-400')} />
              {pendingRequests.length > 0 && (
                <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
              )}
            </span>
            Pending access requests ({pendingRequests.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {pendingRequests.length === 0 ? (
            <div className="text-sm text-gray-600">
              <p className="mb-3">
                No one&apos;s waiting right now. <b>Share your CT&nbsp;HUB link</b> with anyone — when they sign
                in with Google, they&apos;ll appear here for you to approve and give a role. You don&apos;t need
                to add their email first.
              </p>
              <Button onClick={copyInviteLink} variant="outline" size="sm">
                {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Link copied' : 'Copy invite link'}
              </Button>
            </div>
          ) : (
            <>
            <p className="text-xs text-amber-800">
              These people signed in with the shared link and are waiting for you to let them in.
              Pick a role and <b>Approve</b> — or <b>Deny</b> to keep them out. No need to add their email first.
            </p>
            <div className="divide-y divide-amber-200">
              {pendingRequests.map(u => {
                const busy = busyId === `req:${u.id}`
                const sel = requestRole[u.id] ?? 'viewer'
                return (
                  <div key={u.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
                        {(u.name || u.full_name || u.email)[0]?.toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{u.name || u.full_name || 'No name'}</p>
                        <p className="text-xs text-gray-500 flex items-center gap-1 truncate">
                          <Mail className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{u.email}</span>
                        </p>
                        {u.created_at && (
                          <p className="text-[11px] text-gray-400 mt-0.5">Requested {timeAgo(u.created_at)}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <select
                        value={sel}
                        disabled={busy}
                        onChange={e => setRequestRole(prev => ({ ...prev, [u.id]: e.target.value as Role }))}
                        className="h-9 rounded-xl border border-gray-300 bg-white px-2 text-xs font-semibold text-gray-700 disabled:bg-gray-50"
                        title="The role this person gets when you approve them"
                      >
                        {ROLES.map(r => <option key={r} value={r}>{roleLabels[r].label}</option>)}
                      </select>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => approveRequest(u)}
                        className="bg-green-600 hover:bg-green-700 text-white"
                      >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCheck className="h-3.5 w-3.5" />}
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => denyRequest(u)}
                        className="text-rose-600 hover:bg-rose-50 border-rose-200"
                      >
                        <ThumbsDown className="h-3.5 w-3.5" />
                        Deny
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ─── Stats strip ───────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <StatTile label="Total"         value={totalUsers}        icon={<Users className="h-4 w-4" />}    tone="slate"  onClick={() => setStatusFilter('all')}           active={statusFilter === 'all'} />
        <StatTile label="Active"        value={activeCount}       icon={<UserCheck className="h-4 w-4" />} tone="green"  onClick={() => setStatusFilter('active')}        active={statusFilter === 'active'} />
        <StatTile label="Admins"        value={adminCount}        icon={<Shield className="h-4 w-4" />}    tone="blue"   onClick={() => setStatusFilter('admins')}        active={statusFilter === 'admins'} />
        <StatTile label="Portal Owners" value={portalOwnerCount}  icon={<Crown className="h-4 w-4" />}     tone="amber"  onClick={() => setStatusFilter('portal_owners')} active={statusFilter === 'portal_owners'} />
      </div>

      {/* ─── Filter chips + search ───────────────── */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            className="pl-9"
            placeholder="Search by name or email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip active={statusFilter === 'all'}       onClick={() => setStatusFilter('all')}>All</FilterChip>
          <FilterChip active={statusFilter === 'active'}    onClick={() => setStatusFilter('active')}>Active</FilterChip>
          <FilterChip active={statusFilter === 'inactive'}  onClick={() => setStatusFilter('inactive')}>Inactive</FilterChip>
          <FilterChip active={statusFilter === 'admins'}    onClick={() => setStatusFilter('admins')}>Admins</FilterChip>
          {anonymousCount > 0 && (
            <label className={cn(
              'inline-flex items-center gap-1 text-xs px-2.5 h-7 rounded-full border cursor-pointer',
              showAnonymous
                ? 'border-blue-200 bg-blue-50 text-blue-700'
                : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50',
            )}>
              <input type="checkbox" checked={showAnonymous} onChange={e => setShowAnonymous(e.target.checked)} className="h-3 w-3" />
              <EyeOff className="h-3 w-3" /> Show anonymous ({anonymousCount})
            </label>
          )}
        </div>
      </div>

      {/* ─── Plain-English guide to each control on a row ───────── */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="pt-4 pb-4 text-xs text-blue-900 leading-relaxed">
          <p className="font-semibold mb-1 flex items-center gap-1.5"><Info className="h-3.5 w-3.5" /> How to read each row</p>
          <p className="mb-2">Almost always you only touch the <b>Role</b> dropdown — that one role decides what the person can do in <i>every</i> module. The rest is optional.</p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 list-disc pl-5">
            <li><b>Role</b> — the single role the user holds everywhere. Set this and you&apos;re done.</li>
            <li><b>Active / Inactive</b> — whether the user can sign in at all.</li>
            <li><b>Make owner / Revoke owner</b> — promote an admin to Portal Owner.</li>
            <li><b>Advanced</b> — <i>optional.</i> Only if someone needs a <i>different</i> role in one specific module, or should be blocked from a module.</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-5 w-5 text-blue-600" />
            All Users ({filtered.length}{filtered.length !== totalUsers && <span className="text-gray-400 font-normal"> of {totalUsers}</span>})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">
              {search ? 'No users match your search' : 'No users yet — share the invite link.'}
            </p>
          ) : (
            <div className="space-y-1">
              {filtered.map(u => {
                const isSelf = u.id === currentUserId
                const busy = busyId === u.id
                const userOverrides = rolesFor(u.id)
                const userBlocks    = blocksFor(u.id)
                const expanded = expandedUserId === u.id
                return (
                  <div key={u.id} className="border-b border-gray-100 last:border-0">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`h-9 w-9 rounded-full ${u.is_portal_owner ? 'bg-amber-100 text-amber-700 ring-2 ring-amber-300' : 'bg-blue-100 text-blue-700'} flex items-center justify-center font-bold text-sm flex-shrink-0`}>
                        {u.is_portal_owner ? <Crown className="h-4 w-4" /> : (u.name || u.full_name || u.email)[0]?.toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate flex items-center gap-1.5">
                          {u.name || u.full_name || 'No name'}
                          {u.is_portal_owner && (
                            <Badge variant="warning" className="text-[10px] inline-flex items-center gap-1">
                              <Crown className="h-3 w-3" /> Portal Owner
                            </Badge>
                          )}
                          {isSelf && <span className="text-xs text-blue-600 font-normal">(you)</span>}
                        </p>
                        <p className="text-xs text-gray-500 flex items-center gap-1 truncate">
                          <Mail className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{u.email}</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <select
                        value={u.role}
                        disabled={busy || isSelf}
                        onChange={e => updateRole(u, e.target.value as Role)}
                        className="h-9 rounded-xl border border-gray-300 bg-white px-2 text-xs font-semibold text-gray-700 disabled:bg-gray-50 disabled:text-gray-400"
                        title={isSelf ? "You can't change your own role" : roleLabels[u.role].description}
                      >
                        {ROLES.map(r => <option key={r} value={r}>{roleLabels[r].label}</option>)}
                      </select>

                      <Badge variant={u.is_active ? 'success' : 'secondary'}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </Badge>

                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || isSelf}
                        onClick={() => toggleActive(u)}
                        className={u.is_active ? 'text-red-600 hover:bg-red-50' : 'text-green-600 hover:bg-green-50'}
                      >
                        {u.is_active ? (
                          <><UserX className="h-3.5 w-3.5" />Deactivate</>
                        ) : (
                          <><UserCheck className="h-3.5 w-3.5" />Activate</>
                        )}
                      </Button>

                      {currentUserIsPortalOwner && u.role === 'admin' && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => togglePortalOwner(u)}
                          className={u.is_portal_owner ? 'text-amber-700 hover:bg-amber-50 border-amber-300' : 'text-amber-700 hover:bg-amber-50'}
                          title={u.is_portal_owner ? 'Revoke Portal Owner' : 'Make Portal Owner'}
                        >
                          <Crown className="h-3.5 w-3.5" />
                          {u.is_portal_owner ? 'Revoke owner' : 'Make owner'}
                        </Button>
                      )}

                      {currentUserIsPortalOwner && !isSelf && !u.is_active && (
                        deleteArmed === u.id ? (
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={busy}
                            onClick={() => deleteUser(u)}
                            title="Click again to permanently delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {busy ? 'Deleting…' : 'Confirm delete'}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => armDelete(u.id)}
                            className="text-red-600 hover:bg-red-50 border-red-300"
                            title="Delete this deactivated user — permanent, click twice to confirm"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </Button>
                        )
                      )}

                      {/* Per-user Access expander — module-role overrides + module blocks */}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setExpandedUserId(expanded ? null : u.id)}
                        title="Optional / advanced: give this person a different role in one specific module, or block them from a module. Most users never need this."
                        className={cn(
                          (userOverrides.length + userBlocks.length) > 0 && 'border-blue-300 text-blue-700 bg-blue-50',
                        )}
                      >
                        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        <Settings2 className="h-3.5 w-3.5" />
                        Advanced
                        {userOverrides.length > 0 && (
                          <Badge variant="default" className="ml-1 text-[10px] inline-flex items-center gap-0.5" title="Module role overrides">
                            <Layers className="h-2.5 w-2.5" />{userOverrides.length}
                          </Badge>
                        )}
                        {userBlocks.length > 0 && (
                          <Badge className="ml-1 text-[10px] bg-rose-100 text-rose-800 inline-flex items-center gap-0.5" title="Modules blocked for this user">
                            <Ban className="h-2.5 w-2.5" />{userBlocks.length}
                          </Badge>
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Expanded panel: per-module role overrides + blocks */}
                  {expanded && (
                    <>
                      <ModuleRolesPanel
                        user={u}
                        defaultRole={u.role}
                        overrides={userOverrides}
                        roleLabels={roleLabels}
                        busyId={busyId}
                        onSet={(slug, role) => setUserModuleRole(u.id, slug, role)}
                        onRemove={(slug) => removeUserModuleRole(u.id, slug)}
                      />
                      <ModuleBlocksPanel
                        user={u}
                        blocks={userBlocks}
                        busyId={busyId}
                        onBlock={(slug) => blockUserModule(u.id, slug)}
                        onUnblock={(slug) => unblockUserModule(u.id, slug)}
                      />
                    </>
                  )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Roles reference card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-5 w-5 text-slate-600" />
            What each role can do
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
              <Badge variant="warning" className="mb-2 inline-flex items-center gap-1">
                <Crown className="h-3 w-3" /> Portal Owner
              </Badge>
              <p className="text-xs text-amber-900">
                Super-power on top of admin. Promotes/demotes other admins to Portal Owner,
                edits portal-wide settings and layouts. There must always be at least one.
              </p>
            </div>
            {ROLES.map(r => (
              <div key={r} className="rounded-xl border border-gray-200 p-3">
                <Badge variant={r === 'admin' ? 'default' : r === 'uploader' ? 'warning' : 'secondary'} className="mb-2">
                  {roleLabels[r].label}
                </Badge>
                <p className="text-xs text-gray-600">{roleLabels[r].description}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ─── Allowlist ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="h-5 w-5 text-emerald-600" />
            Allowed Emails ({allowed.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-900">
            <b>Optional shortcut.</b> Emails on this list are <b>auto-approved</b> — they sign in and
            become active right away with the role you set, skipping the approval queue. You don&apos;t
            have to use it: anyone can sign in via the shared link and simply wait in
            <b> Pending access requests</b> above for you to approve.
          </div>

          <form onSubmit={addAllowedEmail} className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <div className="flex-1">
              <label className="text-xs font-semibold text-gray-600 mb-1 block">Email</label>
              <Input
                type="email"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                placeholder="person@example.com"
                disabled={adding}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">Starting role</label>
              <select
                value={newRole}
                onChange={e => setNewRole(e.target.value as Role)}
                disabled={adding}
                className="h-10 rounded-xl border border-gray-300 bg-white px-3 text-sm min-w-[10rem]"
                title="The role this person gets when they first sign in. You can change it anytime from the Users list above."
              >
                {ROLES.map(r => <option key={r} value={r}>{roleLabels[r].label}</option>)}
              </select>
            </div>
            <Button type="submit" disabled={adding || !newEmail.trim()}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add to allowlist
            </Button>
          </form>
          <p className="text-[11px] text-gray-500">
            The role dropdown on each row is <b>live</b> — change it and the user&apos;s current role updates immediately
            (no need to bounce between this card and the Users list). For per-module role overrides, use <b>Advanced</b> on the Users list above.
          </p>

          {allowed.length === 0 ? (
            <p className="text-sm text-gray-500 italic py-2">
              No emails allowlisted yet. Add one above.
            </p>
          ) : (
            <div className="divide-y divide-gray-100">
              {allowed.map(a => {
                const onProfile = users.some(u => u.email?.toLowerCase() === a.email)
                const busyMe = removing === a.email
                return (
                  <div key={a.email} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
                        <Mail className="h-3.5 w-3.5 text-gray-400" />
                        <span className="font-mono text-xs">{a.email}</span>
                        {onProfile && <Badge variant="success" className="text-[10px]">signed in</Badge>}
                      </p>
                      {a.notes && <p className="text-xs text-gray-400 mt-0.5 truncate">{a.notes}</p>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <select
                        value={a.role}
                        disabled={busyMe}
                        onChange={e => updateAllowedRole(a.email, e.target.value as Role)}
                        title={onProfile
                          ? 'Changing this updates the user\'s current role immediately'
                          : 'Role they get on first sign-in'}
                        className="h-9 rounded-xl border border-gray-300 bg-white px-2 text-xs font-semibold text-gray-700 disabled:bg-gray-50"
                      >
                        {ROLES.map(r => <option key={r} value={r}>{roleLabels[r].label}</option>)}
                      </select>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyMe}
                        onClick={() => removeAllowedEmail(a.email)}
                        className="text-rose-600 hover:bg-rose-50 border-rose-200"
                      >
                        {busyMe ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* How users join — updated copy reflecting allowlist */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-blue-100 text-blue-700 flex-shrink-0">
              <Send className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-blue-900 mb-1">How users join</p>
              <p className="text-sm text-blue-800 leading-relaxed">
                <b>Step 1:</b> Share the CT&nbsp;HUB link with anyone.&nbsp;
                <b>Step 2:</b> When they sign in with Google, they show up under <b>Pending access requests</b> at
                the top of this page (and you get a notification). Pick a role and <b>Approve</b> — done. No need to
                know or pre-add their email. <span className="text-blue-700">(Tip: for people you already know, add
                their email to the allowlist below to auto-approve them so they skip the wait.)</span>
              </p>
              <Button onClick={copyInviteLink} size="sm" variant="outline" className="mt-3">
                {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Link copied' : 'Copy invite link'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Per-user module role overrides panel ───────────────────────────────────
function ModuleRolesPanel({
  user, defaultRole, overrides, roleLabels, busyId, onSet, onRemove,
}: {
  user: Profile
  defaultRole: Role
  overrides: UserModuleRole[]
  roleLabels: RoleLabelMap
  busyId: string | null
  onSet: (moduleSlug: string, role: Role) => void
  onRemove: (moduleSlug: string) => void
}) {
  // Module options that don't already have an override
  const overrideSlugs = new Set(overrides.map(o => o.module_slug))
  const availableModules = OVERRIDABLE_MODULES.filter(m => !overrideSlugs.has(m.slug))

  return (
    <div className="px-4 py-3 mb-2 rounded-xl bg-slate-50 border border-slate-200">
      <p className="text-xs text-gray-600 mb-3">
        <b>{user.name || user.email}</b> is <Badge variant="secondary" className="text-[10px]">{roleLabels[defaultRole]?.label || defaultRole}</Badge> by default.
        Add an override for a module below to give them a different role there.
      </p>

      {overrides.length > 0 ? (
        <div className="space-y-1 mb-3">
          {overrides.map(o => {
            const mod = OVERRIDABLE_MODULES.find(m => m.slug === o.module_slug)
            const key = `umr:${user.id}:${o.module_slug}`
            const busy = busyId === key
            return (
              <div key={o.module_slug} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                <div className="min-w-0 flex items-center gap-2">
                  <Layers className="h-3.5 w-3.5 text-slate-400" />
                  <span className="font-medium text-gray-800">{mod?.label || o.module_slug}</span>
                  <span className="text-[11px] font-mono text-gray-400">{o.module_slug}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <select
                    value={o.role}
                    disabled={busy}
                    onChange={e => onSet(o.module_slug, e.target.value as Role)}
                    className="h-8 rounded-lg border border-gray-300 bg-white px-2 text-xs font-semibold text-gray-700"
                  >
                    {ROLES.map(r => <option key={r} value={r}>{roleLabels[r].label}</option>)}
                  </select>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => onRemove(o.module_slug)}
                    className="h-8 w-8 p-0 text-rose-600 hover:bg-rose-50"
                    title="Remove override (reverts to default role)"
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-xs text-gray-400 italic mb-3">No module overrides yet — using the default role for every module.</p>
      )}

      {availableModules.length > 0 ? (
        <AddOverrideRow
          available={availableModules}
          defaultRole={defaultRole}
          roleLabels={roleLabels}
          onAdd={(slug, role) => onSet(slug, role)}
        />
      ) : (
        <p className="text-[11px] text-gray-400">Every module already has an override.</p>
      )}
    </div>
  )
}

// ─── Per-user module BLOCK panel ────────────────────────────────────────────
function ModuleBlocksPanel({
  user, blocks, busyId, onBlock, onUnblock,
}: {
  user: Profile
  blocks: UserModuleBlock[]
  busyId: string | null
  onBlock: (moduleSlug: string) => void
  onUnblock: (moduleSlug: string) => void
}) {
  const blockedSlugs = new Set(blocks.map(b => b.module_slug))
  const availableModules = OVERRIDABLE_MODULES.filter(m => !blockedSlugs.has(m.slug))
  const [pickSlug, setPickSlug] = useState(availableModules[0]?.slug ?? '')

  return (
    <div className="px-4 py-3 mb-2 rounded-xl bg-rose-50 border border-rose-200">
      <p className="text-xs text-rose-900 mb-3 flex items-start gap-1.5">
        <Ban className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
        <span>
          Block specific modules from <b>{user.name || user.email}</b>. Blocked modules
          disappear from their dashboard and sidebar regardless of their role.
        </span>
      </p>

      {blocks.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {blocks.map(b => {
            const mod = OVERRIDABLE_MODULES.find(m => m.slug === b.module_slug)
            const key = `umb:${user.id}:${b.module_slug}`
            const busy = busyId === key
            return (
              <span
                key={b.module_slug}
                className="inline-flex items-center gap-1.5 rounded-full bg-rose-100 border border-rose-300 px-2 py-1 text-xs text-rose-900"
              >
                <Ban className="h-3 w-3" />
                <span className="font-medium">{mod?.label || b.module_slug}</span>
                <button
                  type="button"
                  onClick={() => onUnblock(b.module_slug)}
                  disabled={busy}
                  className="hover:text-rose-700 ml-0.5"
                  title="Unblock"
                >
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                </button>
              </span>
            )
          })}
        </div>
      ) : (
        <p className="text-xs text-rose-800 italic mb-3">No modules blocked for this user.</p>
      )}

      {availableModules.length > 0 ? (
        <form
          onSubmit={(e) => { e.preventDefault(); if (pickSlug) onBlock(pickSlug) }}
          className="flex items-center gap-2 pt-2 border-t border-rose-200"
        >
          <select
            value={pickSlug}
            onChange={e => setPickSlug(e.target.value)}
            className="h-9 rounded-xl border border-rose-300 bg-white px-2 text-xs font-medium text-rose-900 flex-1"
          >
            {availableModules.map(m => <option key={m.slug} value={m.slug}>{m.label}</option>)}
          </select>
          <Button type="submit" size="sm" disabled={!pickSlug}
            className="bg-rose-600 hover:bg-rose-700 text-white">
            <Ban className="h-4 w-4" /> Block
          </Button>
        </form>
      ) : (
        <p className="text-[11px] text-rose-700">Every module is already blocked.</p>
      )}
    </div>
  )
}

function AddOverrideRow({
  available, defaultRole, roleLabels, onAdd,
}: {
  available: { slug: string; label: string }[]
  defaultRole: Role
  roleLabels: RoleLabelMap
  onAdd: (slug: string, role: Role) => void
}) {
  const [slug, setSlug] = useState(available[0]?.slug ?? '')
  const [role, setRole] = useState<Role>(defaultRole)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!slug) return
    onAdd(slug, role)
  }

  return (
    <form onSubmit={submit} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-2 border-t border-slate-200">
      <select
        value={slug}
        onChange={e => setSlug(e.target.value)}
        className="h-9 rounded-xl border border-gray-300 bg-white px-2 text-xs font-medium text-gray-700 flex-1"
      >
        {available.map(m => <option key={m.slug} value={m.slug}>{m.label}</option>)}
      </select>
      <select
        value={role}
        onChange={e => setRole(e.target.value as Role)}
        className="h-9 rounded-xl border border-gray-300 bg-white px-2 text-xs font-semibold text-gray-700"
      >
        {ROLES.map(r => <option key={r} value={r}>{roleLabels[r].label}</option>)}
      </select>
      <Button type="submit" size="sm" disabled={!slug}>
        <Plus className="h-4 w-4" /> Add override
      </Button>
    </form>
  )
}

// ─── Stats tile: clickable mini-stat that doubles as a status filter ──────
const TILE_TONES: Record<'slate'|'green'|'blue'|'amber', { bg: string; ic: string; activeRing: string }> = {
  slate: { bg: 'bg-slate-100', ic: 'text-slate-700', activeRing: 'ring-slate-300' },
  green: { bg: 'bg-emerald-50', ic: 'text-emerald-700', activeRing: 'ring-emerald-300' },
  blue:  { bg: 'bg-blue-50',    ic: 'text-blue-700',    activeRing: 'ring-blue-300' },
  amber: { bg: 'bg-amber-50',   ic: 'text-amber-700',   activeRing: 'ring-amber-300' },
}

// Compact "x ago" for the pending-request timestamp. Falls back to '' on a
// bad/empty date so the row never shows "Invalid Date".
function timeAgo(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const secs = Math.floor((Date.now() - t) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`
  return `${Math.floor(months / 12)} year${Math.floor(months / 12) === 1 ? '' : 's'} ago`
}

function StatTile({ label, value, icon, tone, onClick, active }: {
  label: string
  value: number
  icon: React.ReactNode
  tone: keyof typeof TILE_TONES
  onClick?: () => void
  active?: boolean
}) {
  const t = TILE_TONES[tone]
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group rounded-2xl border border-gray-200 bg-white p-3 text-left transition-all hover:shadow-sm hover:-translate-y-0.5',
        active && `ring-2 ${t.activeRing}`,
      )}
    >
      <div className="flex items-center gap-2.5">
        <div className={cn('h-9 w-9 rounded-xl inline-flex items-center justify-center', t.bg, t.ic)}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
          <p className="text-lg font-bold text-gray-900 leading-tight">{value}</p>
        </div>
      </div>
    </button>
  )
}

function FilterChip({ active, onClick, children }: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center text-xs px-3 h-7 rounded-full border transition-colors',
        active
          ? 'border-blue-500 bg-blue-50 text-blue-700 font-semibold'
          : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
      )}
    >
      {children}
    </button>
  )
}
