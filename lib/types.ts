// Mirror of the public schema in Supabase project `srmd-projects-hub`.
// DO NOT alter the database schema; update these types if the SQL changes.

// Roles are an enum in the database (public.user_role). Source of truth
// for what each role can do is the public.role_permissions table — these
// strings are just labels.
export type Role =
  | 'admin'              // super-user; manages users + permissions
  | 'uploader'           // legacy: edit ops data
  | 'viewer'             // legacy: read-only
  | 'founder'            // org top / Trustee — final Cost Control release
  | 'head'               // PM / dept head / Atm Head — 2nd Cost Control sign-off, inventory final approver
  | 'project_head'       // Project Head — 1st Cost Control sign-off in the 3-stage chain
  | 'engineer'           // site engineer; raises inventory requests; confirms receipt
  | 'site_staff'         // labour / on-site
  | 'contractor'         // external contractor — sees only own bills + entries (JMR)
  | 'backoffice'         // inventory: marks requests "available"
  | 'store_manager'      // inventory: storekeeper — issues material; can also mark "available"
  | 'billing'            // billing team: enters approved Cost Control amounts into IN4 ERP (read-only otherwise)
  | 'backoffice_backup'  // LEGACY — kept for DB enum compat, not surfaced in UI
  | 'hop'                // LEGACY — superseded by `head` (Atm Head)

// Roles shown in the permissions matrix UI. `backoffice_backup` and `hop`
// are intentionally omitted — they're kept in the enum for backward compat
// but the workflow now uses `head` for Atm Head and `backoffice`/`store_manager`
// for the availability-check stage.
export const ALL_ROLES: Role[] = [
  'admin', 'founder', 'head', 'project_head', 'uploader', 'engineer', 'backoffice', 'store_manager',
  'billing', 'site_staff', 'viewer', 'contractor',
]

export type PermAction = 'view' | 'edit' | 'admin'

export interface RolePermission {
  role: Role
  module_slug: string
  can_view: boolean
  can_edit: boolean
  can_admin: boolean
  updated_at: string | null
  updated_by: string | null
}

// Shape of the my_permissions() RPC return + the in-memory perm map used
// by the (app) layout.
export type PermissionMap = Record<string, { view: boolean; edit: boolean; admin: boolean }>

export type IndentStage = 'draft' | 'submitted' | 'verify' | 'approved'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  name: string | null
  role: Role
  is_active: boolean
  /** Portal Owner — additive super-power on top of admin. Can promote/demote
   *  other admins to Portal Owner. There must always be ≥1 Portal Owner. */
  is_portal_owner: boolean
  /** Self-service access lifecycle marker. `null` = brand-new sign-in awaiting
   *  an admin's decision (a pending request); `'approved'` / `'denied'` once an
   *  admin has acted. Only meaningful while `is_active` is false. */
  access_state?: string | null
  created_at: string | null
  updated_at: string | null
}

export interface Project {
  id: string
  code: string
  name: string
  description: string | null
  status: string | null
  /** Physical location / address. Optional. */
  location: string | null
  /** 'individual' | 'group' — group projects parent sub-projects via parent_project_id. */
  project_type: string | null
  parent_project_id: string | null
  // Area Statement (matches budget-hub.html template)
  plot_area_sft: number | null
  built_up_sft: number | null
  carpet_sft: number | null
  super_built_up_sft: number | null
  fsi_permitted: number | null
  fsi_consumed: number | null
  created_at: string | null
  updated_at: string | null
}

export interface ProjectFloor {
  id: string
  project_id: string
  sequence: number
  name: string
  built_up_sft: number | null
  carpet_sft: number | null
  created_at: string | null
  updated_at: string | null
}

export interface Vendor {
  id: string
  name: string
  gstin: string | null
  address: string | null
  contact_person: string | null
  contact_phone: string | null
  contact_email: string | null
  created_at: string | null
  updated_at: string | null
}

export interface Indent {
  id: string
  indent_no: string
  indent_date: string
  project_id: string | null
  sub_project: string | null
  area_of_application: string | null
  raised_by: string | null
  notes: string | null
  upload_id: string | null
  stage: IndentStage
  created_at: string | null
  updated_at: string | null
  projects?: Project | null
}

export interface IndentLine {
  id: string
  indent_id: string
  line_no: number | null
  material_name: string
  material_desc: string | null
  uom: string | null
  indent_qty: number
  area_of_application: string | null
  created_at: string | null
}

export interface PurchaseOrder {
  id: string
  po_no: string
  po_date: string
  vendor_id: string | null
  project_id: string | null
  sub_project: string | null
  subtotal: number
  tax_on_material: number
  other_charges: number
  taxes_on_other_charges: number
  po_amount: number
  notes: string | null
  upload_id: string | null
  created_at: string | null
  updated_at: string | null
  vendors?: Vendor | null
  projects?: Project | null
}

export interface POLine {
  id: string
  po_id: string
  indent_line_id: string | null
  line_no: number | null
  material_name: string
  material_desc: string | null
  uom: string | null
  po_qty: number
  po_rate: number
  subtotal: number
  tax_on_material: number
  other_charges: number
  taxes_on_other_charges: number
  line_amount: number
  created_at: string | null
  updated_at: string | null
}

export interface GRN {
  id: string
  grn_no: string | null
  grn_date: string
  po_id: string | null
  certificate_id: string | null
  notes: string | null
  upload_id: string | null
  created_at: string | null
  updated_at: string | null
  purchase_orders?: PurchaseOrder | null
}

export interface GRNLine {
  id: string
  grn_id: string
  po_line_id: string | null
  received_qty: number
  breakage_qty: number
  net_received_qty: number
  created_at: string | null
}

export interface Invoice {
  id: string
  invoice_no: string
  invoice_date: string
  po_id: string | null
  vendor_id: string | null
  subtotal: number
  tax_on_material: number
  other_charges: number
  taxes_on_other_charges: number
  invoice_amount: number
  notes: string | null
  upload_id: string | null
  created_at: string | null
  updated_at: string | null
  vendors?: Vendor | null
  purchase_orders?: PurchaseOrder | null
}

export interface InvoiceLine {
  id: string
  invoice_id: string
  po_line_id: string | null
  invoice_qty: number
  rate: number
  subtotal: number
  tax_on_material: number
  other_charges: number
  taxes_on_other_charges: number
  line_amount: number
  created_at: string | null
}

export interface Payment {
  id: string
  invoice_id: string | null
  payment_date: string
  amount: number
  method: string | null
  reference_no: string | null
  notes: string | null
  created_by: string | null
  created_at: string | null
  updated_at: string | null
}

export interface Upload {
  id: string
  file_name: string
  file_size_bytes: number | null
  file_storage_path: string | null
  upload_type: string
  status: string
  total_rows: number
  parsed_rows: number
  error_rows: number
  error_log: unknown | null
  uploaded_by: string | null
  created_at: string | null
  completed_at: string | null
  diff_summary: unknown | null
}

// ============================================================
// JMR / Machinery Tracker module
// ============================================================

export type JmrItemCategory = 'equipment' | 'manpower'
export type JmrItemUnit = 'hr' | 'day' | 'nos' | 'cu_m'
export type JmrEntryStatus = 'submitted' | 'pm_approved' | 'flagged'
export type JmrBillStatus = 'submitted' | 'pm_review' | 'approved' | 'paid' | 'rejected'

export interface JmrContractor {
  id: string
  name: string
  gst_number: string | null
  contact_person: string | null
  phone: string | null
  email: string | null
  profile_id: string | null
  status: string
  created_at: string | null
  updated_at: string | null
}

export interface JmrItem {
  id: string
  name: string
  category: JmrItemCategory
  unit: JmrItemUnit
  is_active: boolean
  created_at: string | null
  updated_at: string | null
}

export interface JmrRateCard {
  id: string
  contractor_id: string
  item_id: string
  project_id: string | null
  rate_per_unit: number
  valid_from: string
  valid_till: string | null
  created_at: string | null
  updated_at: string | null
  jmr_contractors?: JmrContractor | null
  jmr_items?: JmrItem | null
  projects?: Project | null
}

export interface JmrUserProjectAccess {
  user_id: string
  project_id: string
  granted_at: string | null
  granted_by: string | null
}

export interface JmrDailyEntry {
  id: string
  project_id: string
  sub_project_id: string | null
  contractor_id: string
  item_id: string
  entry_date: string
  start_meter: number | null
  end_meter: number | null
  quantity: number
  rate_snapshot: number
  amount: number
  work_description: string | null
  log_sheet_photo_url: string | null
  logged_by_user_id: string | null
  status: JmrEntryStatus
  approved_by_user_id: string | null
  approved_at: string | null
  created_at: string | null
  updated_at: string | null
  jmr_contractors?: JmrContractor | null
  jmr_items?: JmrItem | null
  projects?: Project | null
  sub_project?: Project | null
}

export interface JmrBill {
  id: string
  bill_number: string
  contractor_id: string
  project_id: string
  bill_date: string
  period_from: string
  period_to: string
  subtotal: number
  gst_rate: number
  gst_amount: number
  total_amount: number
  bill_photo_url: string | null
  status: JmrBillStatus
  variance_flag: boolean
  variance_notes: string | null
  submitted_by_user_id: string | null
  approved_by_user_id: string | null
  approved_at: string | null
  paid_on: string | null
  payment_ref: string | null
  created_at: string | null
  updated_at: string | null
  jmr_contractors?: JmrContractor | null
  projects?: Project | null
  jmr_bill_line_items?: JmrBillLineItem[]
}

export interface JmrBillLineItem {
  id: string
  bill_id: string
  item_id: string
  sub_project_id: string | null
  billed_quantity: number
  jmr_quantity: number
  rate: number
  amount: number
  variance: number
  variance_pct: number | null
  created_at: string | null
  jmr_items?: JmrItem | null
}

export interface JmrSettings {
  gst_rate_pct: number
  variance_tolerance_pct: number
  variance_tolerance_min_hours: number
  entry_edit_window_hours: number
  weekly_report_day: string
  weekly_report_hour_ist: number
  weekly_report_recipients: string[]
}
