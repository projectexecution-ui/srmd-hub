// Central registry of all dashboard modules. The Dashboard launcher renders
// these tiles, role-filtered. Add a new module here once it has a route.

import {
  ClipboardList, FileText, PackageCheck, Receipt, Wallet,
  Truck, Building2, Upload, Users, Settings, Hammer,
  ExternalLink, BarChart3, Wrench,
} from 'lucide-react'
import type { Role } from './types'

export type ModuleTile = {
  slug: string
  label: string
  description: string
  href: string
  external?: boolean
  icon: typeof ClipboardList
  /** Tailwind colour name family used for the tile chrome */
  tone: 'blue' | 'green' | 'amber' | 'purple' | 'rose' | 'slate' | 'teal' | 'indigo' | 'orange'
  /** Minimum role required to see this tile */
  minRole: Role
  /** Optional "Coming soon" flag — tile shown but greyed */
  comingSoon?: boolean
}

const roleRank: Record<Role, number> = { viewer: 1, uploader: 2, admin: 3 }

export function canSee(tile: ModuleTile, role: Role | null | undefined): boolean {
  if (!role) return false
  return roleRank[role] >= roleRank[tile.minRole]
}

export const MODULES: ModuleTile[] = [
  {
    slug: 'indents',
    label: 'Indents',
    description: 'Material indents raised from sites',
    href: '/indents',
    icon: ClipboardList,
    tone: 'blue',
    minRole: 'viewer',
  },
  {
    slug: 'pos',
    label: 'Purchase Orders',
    description: 'POs issued to vendors',
    href: '/pos',
    icon: FileText,
    tone: 'indigo',
    minRole: 'viewer',
  },
  {
    slug: 'grns',
    label: 'GRN',
    description: 'Goods received notes',
    href: '/grns',
    icon: PackageCheck,
    tone: 'green',
    minRole: 'viewer',
  },
  {
    slug: 'invoices',
    label: 'Invoices',
    description: 'Vendor invoices',
    href: '/invoices',
    icon: Receipt,
    tone: 'amber',
    minRole: 'viewer',
  },
  {
    slug: 'payments',
    label: 'Payments',
    description: 'Payments against invoices',
    href: '/payments',
    icon: Wallet,
    tone: 'teal',
    minRole: 'viewer',
    comingSoon: true,
  },
  {
    slug: 'vendors',
    label: 'Vendors',
    description: 'Vendor master',
    href: '/vendors',
    icon: Truck,
    tone: 'purple',
    minRole: 'viewer',
  },
  {
    slug: 'projects',
    label: 'Projects',
    description: 'Site / project master',
    href: '/projects',
    icon: Building2,
    tone: 'slate',
    minRole: 'viewer',
  },
  {
    slug: 'jmr',
    label: 'JMR',
    description: 'Joint Measurement Records',
    href: '/jmr',
    icon: Wrench,
    tone: 'orange',
    minRole: 'viewer',
    comingSoon: true,
  },
  {
    slug: 'attendance',
    label: 'Attendance',
    description: 'Open the SiteAttend app',
    href: process.env.NEXT_PUBLIC_ATTENDANCE_URL || 'https://siteattend.vercel.app',
    external: true,
    icon: ExternalLink,
    tone: 'rose',
    minRole: 'viewer',
  },
  {
    slug: 'uploads',
    label: 'Uploads',
    description: 'Excel imports history',
    href: '/uploads',
    icon: Upload,
    tone: 'slate',
    minRole: 'uploader',
  },
  {
    slug: 'budget-vs-actual',
    label: 'Budget vs Actual',
    description: 'Upload IN4 export → cost variance dashboard',
    href: '/budget',
    icon: BarChart3,
    tone: 'teal',
    minRole: 'viewer',
  },
  {
    slug: 'admin-users',
    label: 'Users & Roles',
    description: 'Manage app users',
    href: '/admin/users',
    icon: Users,
    tone: 'slate',
    minRole: 'admin',
  },
  {
    slug: 'admin-settings',
    label: 'Settings',
    description: 'App settings (admin email, etc.)',
    href: '/admin/settings',
    icon: Settings,
    tone: 'slate',
    minRole: 'admin',
  },
]

// Tone → Tailwind classes. Kept here so JIT picks them up.
export const TILE_TONES: Record<ModuleTile['tone'], { bg: string; ic: string; ring: string }> = {
  blue:   { bg: 'bg-blue-50',   ic: 'text-blue-700',   ring: 'group-hover:ring-blue-200' },
  indigo: { bg: 'bg-indigo-50', ic: 'text-indigo-700', ring: 'group-hover:ring-indigo-200' },
  green:  { bg: 'bg-green-50',  ic: 'text-green-700',  ring: 'group-hover:ring-green-200' },
  amber:  { bg: 'bg-amber-50',  ic: 'text-amber-700',  ring: 'group-hover:ring-amber-200' },
  purple: { bg: 'bg-purple-50', ic: 'text-purple-700', ring: 'group-hover:ring-purple-200' },
  rose:   { bg: 'bg-rose-50',   ic: 'text-rose-700',   ring: 'group-hover:ring-rose-200' },
  slate:  { bg: 'bg-slate-100', ic: 'text-slate-700',  ring: 'group-hover:ring-slate-200' },
  teal:   { bg: 'bg-teal-50',   ic: 'text-teal-700',   ring: 'group-hover:ring-teal-200' },
  orange: { bg: 'bg-orange-50', ic: 'text-orange-700', ring: 'group-hover:ring-orange-200' },
}
