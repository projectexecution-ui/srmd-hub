'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import type { Profile } from '@/lib/types'
import {
  LayoutDashboard, ClipboardList, FileText, PackageCheck, Receipt,
  Truck, Building2, Settings, LogOut, Menu, X, Hammer, Users, Upload,
} from 'lucide-react'

interface NavBarProps {
  profile: Profile
}

const ALL_LINKS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, minRole: 'viewer' as const },
  { href: '/indents',   label: 'Indents',   icon: ClipboardList,   minRole: 'viewer' as const },
  { href: '/pos',       label: 'POs',       icon: FileText,        minRole: 'viewer' as const },
  { href: '/grns',      label: 'GRN',       icon: PackageCheck,    minRole: 'viewer' as const },
  { href: '/invoices',  label: 'Invoices',  icon: Receipt,         minRole: 'viewer' as const },
  { href: '/vendors',   label: 'Vendors',   icon: Truck,           minRole: 'viewer' as const },
  { href: '/projects',  label: 'Projects',  icon: Building2,       minRole: 'viewer' as const },
  { href: '/uploads',   label: 'Uploads',   icon: Upload,          minRole: 'uploader' as const },
  { href: '/admin/users',    label: 'Users',     icon: Users,    minRole: 'admin' as const },
  { href: '/admin/settings', label: 'Settings',  icon: Settings, minRole: 'admin' as const },
]

const ROLE_RANK = { viewer: 1, uploader: 2, admin: 3 } as const

export default function NavBar({ profile }: NavBarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState(false)

  const links = ALL_LINKS.filter(l => ROLE_RANK[profile.role] >= ROLE_RANK[l.minRole])

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 h-14 bg-white border-b border-gray-200">
        <Link href="/dashboard" className="flex items-center gap-2">
          <Hammer className="h-5 w-5 text-blue-600" />
          <span className="font-bold text-gray-900">SRMD Hub</span>
        </Link>
        <button
          onClick={() => setOpen(o => !o)}
          className="p-2 -mr-2 text-gray-600 hover:text-gray-900"
          aria-label="Menu"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile sliding panel */}
      {open && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/40" onClick={() => setOpen(false)}>
          <nav
            className="absolute right-0 top-0 bottom-0 w-72 bg-white shadow-xl flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 h-14 border-b border-gray-200">
              <span className="font-bold text-gray-900">SRMD Hub</span>
              <button onClick={() => setOpen(false)} className="p-2 -mr-2"><X className="h-5 w-5" /></button>
            </div>
            <ProfileRow profile={profile} />
            <div className="flex-1 overflow-y-auto py-2">
              {links.map(({ href, label, icon: Icon }) => {
                const active = isActive(pathname, href)
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      'flex items-center gap-3 px-4 py-2.5 text-sm font-medium',
                      active ? 'text-blue-700 bg-blue-50' : 'text-gray-700 hover:bg-gray-50'
                    )}
                  >
                    <Icon className={cn('h-5 w-5', active ? 'text-blue-700' : 'text-gray-400')} />
                    {label}
                  </Link>
                )
              })}
            </div>
            <button
              onClick={signOut}
              className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-gray-600 hover:text-red-600 hover:bg-red-50 border-t border-gray-200"
            >
              <LogOut className="h-5 w-5" />
              Sign out
            </button>
          </nav>
        </div>
      )}

      {/* Desktop sidebar */}
      <nav className="hidden md:flex md:flex-col md:w-60 md:flex-shrink-0 md:border-r md:border-gray-200 md:bg-white md:h-screen md:sticky md:top-0">
        <div className="flex items-center gap-2 px-4 h-16 border-b border-gray-200">
          <Hammer className="h-6 w-6 text-blue-600" />
          <span className="font-bold text-gray-900 text-base">SRMD Hub</span>
        </div>
        <ProfileRow profile={profile} />
        <div className="flex-1 overflow-y-auto py-2 px-2">
          {links.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href)
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-xl transition-colors',
                  active ? 'text-blue-700 bg-blue-50' : 'text-gray-700 hover:bg-gray-50'
                )}
              >
                <Icon className={cn('h-4.5 w-4.5', active ? 'text-blue-700' : 'text-gray-400')} />
                {label}
              </Link>
            )
          })}
        </div>
        <button
          onClick={signOut}
          className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-gray-600 hover:text-red-600 hover:bg-red-50 border-t border-gray-200"
        >
          <LogOut className="h-5 w-5" />
          Sign out
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
        <p className="text-xs text-gray-500 truncate capitalize">{profile.role}</p>
      </div>
    </div>
  )
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard' || pathname === '/'
  return pathname === href || pathname.startsWith(href + '/')
}
