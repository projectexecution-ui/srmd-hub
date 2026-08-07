// Central registry of dashboard modules — pure metadata.
// What a user can SEE/EDIT/ADMIN is no longer hardcoded here; it lives
// in public.role_permissions and is editable by an Admin via the UI.

import {
  ClipboardList, FileText, PackageCheck, Receipt, Wallet,
  Truck, Building2, Upload, Users, Settings, ShieldCheck,
  ExternalLink, Wrench, Calculator, FileSpreadsheet,
  Boxes, Inbox, GitCompareArrows, Tags, FlaskConical, ListTree, Mail, Activity, ListChecks,
  ClipboardCheck, CalendarClock,
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
  { slug: 'indents',          label: 'Indents',          description: 'Material indents raised from sites',         href: '/indents',        icon: ClipboardList, tone: 'blue' },
  { slug: 'pos',              label: 'Purchase Orders',  description: 'POs issued to vendors',                       href: '/pos',            icon: FileText,      tone: 'indigo' },
  { slug: 'grns',             label: 'GRN',              description: 'Goods received notes',                        href: '/grns',           icon: PackageCheck,  tone: 'green' },
  { slug: 'invoices',         label: 'Invoices',         description: 'Vendor invoices',                             href: '/invoices',       icon: Receipt,       tone: 'amber' },
  { slug: 'payments',         label: 'Payments',         description: 'Payments against invoices',                   href: '/payments',       icon: Wallet,        tone: 'teal',   comingSoon: true },
  { slug: 'vendors',          label: 'Vendors',          description: 'Vendor master',                               href: '/vendors',        icon: Truck,         tone: 'purple' },
  { slug: 'projects',         label: 'Projects',         description: 'Site / project master',                       href: '/projects',       icon: Building2,     tone: 'slate' },
  // Single JMR tile only. Sub-sections (Admin, Matrix, Dashboard, Entry)
  // live inside /jmr's own landing — no need to duplicate them on the hub.
  // The slug `jmr-admin` still exists in role_permissions and gates the admin
  // sub-routes; it's just not shown as a separate tile. (Bills feature removed.)
  { slug: 'jmr',              label: 'JMR / Machinery',  description: 'Site machinery hours, JMR matrix, bills',     href: '/jmr',            icon: Wrench,        tone: 'orange' },
  { slug: 'daily-site-report',label: 'Daily Site Report',description: 'Site material/supplier deliveries — received → bill with CT → GRN → paid, with a smart checklist for the Atm Head', href: '/daily-site-report', icon: ClipboardCheck, tone: 'teal' },
  { slug: 'schedule',         label: 'Schedule & WOs',   description: 'Per-project schedule — plan vs actual, Work-Order deadlines, drawings & floor-by-floor progress; macro for management, micro for engineers', href: '/schedule', icon: CalendarClock, tone: 'indigo' },
  { slug: 'inventory',        label: 'Inventory',        description: 'Stock, item master, requests & issue chain',  href: '/inventory',      icon: Boxes,         tone: 'green' },
  { slug: 'comparison',       label: 'Comparison Maker', description: 'Compare vendor quotations side-by-side — L1, L2, missing items', href: '/comparisons', icon: GitCompareArrows, tone: 'purple' },
  { slug: 'established-rates',label: 'Established Rates',description: 'Master rate catalogue — Discipline → Category → Sub-category, multi-vendor with L1 highlight', href: '/established-rates', icon: Tags, tone: 'teal' },
  { slug: 'attendance',       label: 'Attendance',       description: 'Open the SiteAttend app',                     href: process.env.NEXT_PUBLIC_ATTENDANCE_URL || 'https://siteattend.vercel.app', external: true, icon: ExternalLink, tone: 'rose' },
  { slug: 'uploads',          label: 'Uploads',          description: 'Excel imports history',                       href: '/uploads',        icon: Upload,        tone: 'slate' },
  { slug: 'budget-vs-actual', label: 'Budget (IN4 BPH)',     description: 'IN4 Budget Performance report — server-backed BPH dashboard', href: '/budget',              icon: FileSpreadsheet, tone: 'teal' },
  { slug: 'procurement-tracker', label: 'Indent → PO Tracker', description: 'Upload IN4 PURCHINDENT_TO_ISSUE_RPT or PUR_PurchaseOrderReport — Indent → PO → GRN → Invoice with pending-receipts focus', href: '/procurement-tracker', icon: FileSpreadsheet, tone: 'amber' },
  { slug: 'contractor-report', label: 'Contractor Report',  description: 'Upload IN4 “All Types Certificates Details” → Category × Contractor summary, in-app view + Excel export', href: '/contractor-report', icon: FileSpreadsheet, tone: 'blue' },
  { slug: 'supplier-report',  label: 'Supplier Report',    description: 'Upload IN4 “All Purchase Payments Report” → Category × Supplier summary, in-app view + Excel/PDF export', href: '/supplier-report', icon: FileSpreadsheet, tone: 'green' },
  { slug: 'budget-vs-actual-v2', label: 'Budget vs Actual V2', description: 'Consolidated tree — budget + contractor + supplier in one snapshot, with ₹/sft and open/closed status', href: '/budget-vs-actual-v2', icon: ListTree, tone: 'teal' },
  { slug: 'cost-control',     label: 'Cost Control',           description: 'Working Sheets, budgets & approvals (SRASSK)',                 href: '/cost-control',        icon: Calculator,      tone: 'indigo' },
  { slug: 'bills-pipeline',   label: 'Bills Pipeline',         description: 'Weekly SRA contractor bills command card — stalls, push list, pipeline bars', href: '/bills-pipeline', icon: Activity, tone: 'rose' },
  { slug: 'stuck-bills',      label: 'Bills Checklist',        description: 'Contractor bills pending with CT — verify documents before approval', href: '/stuck-bills', icon: ListChecks, tone: 'amber' },
  // Smart-Blueprint sandbox — proves the SLA + aging-dashboard UX in
  // isolation before any production module gets touched. Purple tone
  // (+ FlaskConical icon) marks it as an experiment.
  { slug: 'blueprint-demo',   label: 'Blueprint Demo',   description: 'Sandbox for Smart Blueprints — SLA dashboard, auto-derived thresholds, escalation chain', href: '/blueprint-demo', icon: FlaskConical, tone: 'purple' },
  { slug: 'admin-users',      label: 'Users & Roles',    description: 'Manage app users',                            href: '/admin/users',    icon: Users,         tone: 'slate' },
  { slug: 'admin-settings',   label: 'Settings',         description: 'App settings (admin email, etc.)',            href: '/admin/settings', icon: Settings,      tone: 'slate' },
  { slug: 'admin-permissions',label: 'Permissions',      description: 'Who can do what in each module',              href: '/admin/permissions', icon: ShieldCheck, tone: 'slate' },
]

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
