// Central registry of dashboard modules — pure metadata.
// What a user can SEE/EDIT/ADMIN is no longer hardcoded here; it lives
// in public.role_permissions and is editable by an Admin via the UI.

import {
  ClipboardList, FileText, PackageCheck, Receipt, Wallet,
  Truck, Building2, Upload, Users, Settings, ShieldCheck,
  ExternalLink, BarChart3, Wrench, Calculator, FileSpreadsheet,
} from 'lucide-react'
import type { PermissionMap } from './types'

export type ModuleTile = {
  slug: string
  label: string
  description: string
  href: string
  external?: boolean
  icon: typeof ClipboardList
  /** Tailwind colour name family used for the tile chrome */
  tone: 'blue' | 'green' | 'amber' | 'purple' | 'rose' | 'slate' | 'teal' | 'indigo' | 'orange'
  /** Optional "Coming soon" flag — tile shown but greyed */
  comingSoon?: boolean
}

export const MODULES: ModuleTile[] = [
  { slug: 'indents',          label: 'Indents',          description: 'Material indents raised from sites',         href: '/indents',        icon: ClipboardList, tone: 'blue' },
  { slug: 'pos',              label: 'Purchase Orders',  description: 'POs issued to vendors',                       href: '/pos',            icon: FileText,      tone: 'indigo' },
  { slug: 'grns',             label: 'GRN',              description: 'Goods received notes',                        href: '/grns',           icon: PackageCheck,  tone: 'green' },
  { slug: 'invoices',         label: 'Invoices',         description: 'Vendor invoices',                             href: '/invoices',       icon: Receipt,       tone: 'amber' },
  { slug: 'payments',         label: 'Payments',         description: 'Payments against invoices',                   href: '/payments',       icon: Wallet,        tone: 'teal',   comingSoon: true },
  { slug: 'vendors',          label: 'Vendors',          description: 'Vendor master',                               href: '/vendors',        icon: Truck,         tone: 'purple' },
  { slug: 'projects',         label: 'Projects',         description: 'Site / project master',                       href: '/projects',       icon: Building2,     tone: 'slate' },
  { slug: 'jmr',              label: 'JMR / Machinery',  description: 'Site machinery hours, JMR matrix, bills',     href: '/jmr',            icon: Wrench,        tone: 'orange' },
  { slug: 'jmr-bills',        label: 'JMR Bills',        description: 'Contractor bills with variance check',        href: '/jmr/bills',      icon: Receipt,       tone: 'rose' },
  { slug: 'jmr-admin',        label: 'JMR Admin',        description: 'Items, rate cards, contractors, settings',    href: '/jmr/admin',      icon: Settings,      tone: 'slate' },
  { slug: 'attendance',       label: 'Attendance',       description: 'Open the SiteAttend app',                     href: process.env.NEXT_PUBLIC_ATTENDANCE_URL || 'https://siteattend.vercel.app', external: true, icon: ExternalLink, tone: 'rose' },
  { slug: 'uploads',          label: 'Uploads',          description: 'Excel imports history',                       href: '/uploads',        icon: Upload,        tone: 'slate' },
  { slug: 'budget-vs-actual', label: 'IN4 BPH Report Hub',     description: 'IN4 Budget Performance report — server-backed BPH dashboard', href: '/budget',              icon: FileSpreadsheet, tone: 'teal' },
  { slug: 'in4-indent-to-po', label: 'IN4 Indent to PO Hub',   description: 'IN4 export — Indent → PO funnel tracker',                      href: '/in4/indent-to-po',    icon: ClipboardList,   tone: 'blue' },
  { slug: 'cost-control',     label: 'Cost Control',           description: 'Working Sheets, budgets & approvals (SRASSK)',                 href: '/cost-control',        icon: Calculator,      tone: 'indigo' },
  { slug: 'admin-users',      label: 'Users & Roles',    description: 'Manage app users',                            href: '/admin/users',    icon: Users,         tone: 'slate' },
  { slug: 'admin-settings',   label: 'Settings',         description: 'App settings (admin email, etc.)',            href: '/admin/settings', icon: Settings,      tone: 'slate' },
  { slug: 'admin-permissions',label: 'Permissions',      description: 'Who can do what in each module',              href: '/admin/permissions', icon: ShieldCheck, tone: 'slate' },
]

export function visibleModules(perms: PermissionMap): ModuleTile[] {
  return MODULES.filter(m => perms[m.slug]?.view)
}

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
