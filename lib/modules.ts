// Central registry of dashboard modules — pure metadata.
// What a user can SEE/EDIT/ADMIN is no longer hardcoded here; it lives
// in public.role_permissions and is editable by an Admin via the UI.

import {
  ClipboardList, FileText, PackageCheck, Receipt, Wallet,
  Truck, Building2, Upload, Users, Settings, ShieldCheck,
  ExternalLink, Wrench, Calculator, FileSpreadsheet,
  Boxes, Inbox, GitCompareArrows, Tags, FlaskConical, ListTree, Mail, Activity, ListChecks,
  ClipboardCheck, CalendarClock, ReceiptText, Warehouse,
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
  { slug: 'approvals',        label: 'My Approvals',     description: 'Things waiting on you across every module',   href: '/approvals',      icon: Inbox,         tone: 'rose' },
  { slug: 'ecc',              label: 'Command Centre',   description: 'Your inbox, triaged — what needs action today', href: '/command-center', icon: Mail,          tone: 'teal' },
  // Single JMR tile only. Sub-sections (Admin, Matrix, Dashboard, Entry)
  // live inside /jmr's own landing — no need to duplicate them on the hub.
  // The slug `jmr-admin` still exists in role_permissions and gates the admin
  // sub-routes; it's just not shown as a separate tile. (Bills feature removed.)
  // Warehouse V2 — the HOD's main-gate material in-out register. A separate
  // module from `inventory` on purpose: its own items, locations, stock and
  // ledger, so the never-adopted request/issue chain above is left untouched.
  { slug: 'attendance',       label: 'Attendance',       description: 'Open the SiteAttend app',                     href: process.env.NEXT_PUBLIC_ATTENDANCE_URL || 'https://siteattend.vercel.app', external: true, icon: ExternalLink, tone: 'rose' },
  { slug: 'procurement-tracker', label: 'Indent → PO Tracker', description: 'Live from IN4 — every indent’s cycle (Indent → PO → GRN), what waits for approval, a PO or a delivery, and what is late', href: '/procurement-tracker', icon: FileSpreadsheet, tone: 'amber' },
  { slug: 'budget-vs-actual-v2', label: 'Budget vs Actual V2', description: 'Budget report as a tree — Budget · WO/PO Approved · Paid · Balance · Used% per project, with ₹/sft and open/closed status', href: '/budget-vs-actual-v2', icon: ListTree, tone: 'teal' },
  { slug: 'cost-control',     label: 'Cost Control',           description: 'Working Sheets, budgets & approvals (SRASSK)',                 href: '/cost-control',        icon: Calculator,      tone: 'indigo' },
  { slug: 'bills-booking',    label: 'Bills Booking',          description: 'Contractor (WO) & vendor (PO) bills — entry → Site Head → CT → Atm → Trust → paid, all in one platform', href: '/bills-booking', icon: ReceiptText, tone: 'indigo' },
  { slug: 'bills-pipeline',   label: 'Bills Pipeline',         description: 'Weekly SRA contractor bills command card — stalls, push list, pipeline bars', href: '/bills-pipeline', icon: Activity, tone: 'rose' },
  { slug: 'stuck-bills',      label: 'Bills Checklist',        description: 'Contractor bills pending with CT — verify documents before approval', href: '/stuck-bills', icon: ListChecks, tone: 'amber' },
  // Smart-Blueprint sandbox — proves the SLA + aging-dashboard UX in
  // isolation before any production module gets touched. Purple tone
  // (+ FlaskConical icon) marks it as an experiment.
  { slug: 'admin-users',      label: 'Users & Roles',    description: 'Manage app users',                            href: '/admin/users',    icon: Users,         tone: 'slate' },
  { slug: 'admin-settings',   label: 'Settings',         description: 'App settings (admin email, etc.)',            href: '/admin/settings', icon: Settings,      tone: 'slate' },
  { slug: 'admin-permissions',label: 'Permissions',      description: 'Who can do what in each module',              href: '/admin/permissions', icon: ShieldCheck, tone: 'slate' },
]

// Permission slugs that gate pages INSIDE a module without being a module
// themselves — they have no tile, so the Portal Owner's on/off switch never
// names them. Each maps to the module whose switch governs it; otherwise
// switching JMR off left all 15 JMR admin pages reachable.
export const MODULE_PARENT: Record<string, string> = {
  'jmr-admin': 'jmr',
}
export function moduleOf(slug: string): string {
  return MODULE_PARENT[slug] ?? slug
}

export function visibleModules(perms: PermissionMap): ModuleTile[] {
  return MODULES.filter(m => perms[m.slug]?.view)
}

// Inventory sub-sections are shown purely by ROLE on the Inventory landing —
// there is no per-section on/off registry anymore (it was redundant with roles
// and, when toggled off, hid the whole module). See app/(app)/inventory/page.tsx.

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
