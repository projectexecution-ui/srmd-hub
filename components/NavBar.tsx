'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import type { Profile, PermissionMap } from '@/lib/types'
import {
  LayoutDashboard, ClipboardList, FileText, PackageCheck, Receipt,
  Truck, Building2, Settings, LogOut, Menu, X, Users, Upload,
  BarChart3, ChevronsLeft, ChevronsRight, ShieldCheck,
} from 'lucide-react'

interface NavBarProps {
  profile: Profile
  permissions: PermissionMap
}

// Every link declares the permission slug it requires (view-level).
// Visibility is data-driven from public.role_permissions.
const ALL_LINKS = [
  { href: '/dashboard',        label: 'Dashboard',   icon: LayoutDashboard, slug: null as string | null },
  { href: '/indents',          label: 'Indents',     icon: ClipboardList,   slug: 'indents' },
  { href: '/pos',              label: 'POs',         icon: FileText,        slug: 'pos' },
  { href: '/grns',             label: 'GRN',         icon: PackageCheck,    slug: 'grns' },
  { href: '/invoices',         label: 'Invoices',    icon: Receipt,         slug: 'invoices' },
  { href: '/vendors',          label: 'Vendors',     icon: Truck,           slug: 'vendors' },
  { href: '/projects',         label: 'Projects',    icon: Building2,       slug: 'projects' },
  { href: '/budget',           label: 'Budget',      icon: BarChart3,       slug: 'budget-vs-actual' },
  { href: '/uploads',          label: 'Uploads',     icon: Upload,          slug: 'uploads' },
  { href: '/admin/users',      label: 'Users',       icon: Users,           slug: 'admin-users' },
  { href: '/admin/permissions',label: 'Permissions', icon: ShieldCheck,     slug: 'admin-permissions' },
  { href: '/admin/settings',   label: 'Settings',    icon: Settings,        slug: 'admin-settings' },
] as const

const COLLAPSE_KEY = 'srmd_nav_collapsed'

export default function NavBar({ profile, permissions }: NavBarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [ui, setUi] = useState<{ collapsed: boolean; hydrated: boolean }>({ collapsed: false, hydrated: false })
  const { collapsed, hydrated } = ui

  useEffect(() => {
    let isCollapsed = false
    try { isCollapsed = localStorage.getItem(COLLAPSE_KEY) === '1' } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUi({ collapsed: isCollapsed, hydrated: true })
  }, [])

  function toggleCollapsed() {
    setUi(s => {
      const next = !s.collapsed
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0') } catch {}
      return { ...s, collapsed: next }
    })
  }

  const links = ALL_LINKS.filter(l => l.slug === null || permissions[l.slug]?.view)

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 h-14 bg-white border-b border-gray-200">
        <Link href="/dashboard" className="flex items-center gap-2">
          <img src="/srmd-icon.png" alt="SRMD" className="h-7 w-7" />
          <span className="font-bold text-gray-900">CT HUB</span>
        </Link>
        <button onClick={() => setOpen(o => !o)} className="p-2 -mr-2 text-gray-600 hover:text-gray-900" aria-label="Menu">
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile sliding panel */}
      {open && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/40" onClick={() => setOpen(false)}>
          <nav className="absolute right-0 top-0 bottom-0 w-72 bg-white shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 h-14 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <img src="/srmd-icon.png" alt="SRMD" className="h-7 w-7" />
                <span className="font-bold text-gray-900">CT HUB</span>
              </div>
              <button onClick={() => setOpen(false)} className="p-2 -mr-2"><X className="h-5 w-5" /></button>
            </div>
            <ProfileRow profile={profile} />
            <div className="flex-1 overflow-y-auto py-2">
              {links.map(({ href, label, icon: Icon }) => {
                const active = isActive(pathname, href)
                return (
                  <Link key={href} href={href} onClick={() => setOpen(false)} className={cn(
                    'flex items-center gap-3 px-4 py-2.5 text-sm font-medium',
                    active ? 'text-blue-700 bg-blue-50' : 'text-gray-700 hover:bg-gray-50'
                  )}>
                    <Icon className={cn('h-5 w-5', active ? 'text-blue-700' : 'text-gray-400')} />
                    {label}
                  </Link>
                )
              })}
            </div>
            <button onClick={signOut} className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-gray-600 hover:text-red-600 hover:bg-red-50 border-t border-gray-200">
              <LogOut className="h-5 w-5" />
              Sign out
            </button>
          </nav>
        </div>
      )}

      {/* Desktop sidebar (collapsible) */}
      <nav className={cn(
        'hidden md:flex md:flex-col md:flex-shrink-0 md:border-r md:border-gray-200 md:bg-white md:h-screen md:sticky md:top-0 transition-[width] duration-200 ease-in-out',
        collapsed ? 'md:w-16' : 'md:w-60',
        !hydrated && 'invisible'
      )}>
        <div className={cn('flex items-center h-16 border-b border-gray-200', collapsed ? 'justify-center px-2' : 'justify-between px-3')}>
          {!collapsed ? (
            <Link href="/dashboard" className="flex items-center min-w-0 flex-1 mr-2">
              <img src="/srmd-logo.svg" alt="SRMD" className="h-7 max-w-full object-contain" />
            </Link>
          ) : (
            <Link href="/dashboard" className="flex items-center justify-center">
              <img src="/srmd-icon.png" alt="SRMD" className="h-8 w-8" />
            </Link>
          )}
          <button
            onClick={toggleCollapsed}
            className={cn(
              'p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors',
              collapsed && 'absolute top-4 right-[-12px] bg-white border border-gray-200 shadow-sm'
            )}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </button>
        </div>

        {!collapsed && <ProfileRow profile={profile} />}
        {collapsed && (
          <div className="flex justify-center py-3 border-b border-gray-100" title={profile.name || profile.email}>
            <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm">
              {(profile.name || profile.email)[0].toUpperCase()}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto py-2 px-2">
          {links.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href)
            return (
              <Link key={href} href={href} title={collapsed ? label : undefined} className={cn(
                'flex items-center text-sm font-medium rounded-xl transition-colors',
                collapsed ? 'justify-center px-2 py-2.5 my-0.5' : 'gap-3 px-3 py-2',
                active ? 'text-blue-700 bg-blue-50' : 'text-gray-700 hover:bg-gray-50'
              )}>
                <Icon className={cn('h-5 w-5 flex-shrink-0', active ? 'text-blue-700' : 'text-gray-400')} />
                {!collapsed && <span className="truncate">{label}</span>}
              </Link>
            )
          })}
        </div>

        <button
          onClick={signOut}
          title={collapsed ? 'Sign out' : undefined}
          className={cn(
            'flex items-center text-sm font-medium text-gray-600 hover:text-red-600 hover:bg-red-50 border-t border-gray-200',
            collapsed ? 'justify-center px-2 py-3' : 'gap-3 px-4 py-3'
          )}
        >
          <LogOut className="h-5 w-5 flex-shrink-0" />
          {!collapsed && 'Sign out'}
        </button>
      </nav>
    </>
  )
}

function ProfileRow({ profile }: { profile: Profile }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
      <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm flex-shrink-0">
        {(profile.name || profile.email)[0].toUpperCase()}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{profile.name || profile.full_name || 'User'}</p>
        <p className="text-xs text-gray-500 truncate capitalize">{profile.role.replace('_', ' ')}</p>
      </div>
    </div>
  )
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard' || pathname === '/'
  return pathname === href || pathname.startsWith(href + '/')
}
