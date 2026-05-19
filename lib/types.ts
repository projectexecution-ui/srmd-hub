// Mirror of the public schema in Supabase project `srmd-projects-hub`.
// DO NOT alter the database schema; update these types if the SQL changes.

export type Role = 'admin' | 'uploader' | 'viewer'
export type IndentStage = 'draft' | 'submitted' | 'verify' | 'approved'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  name: string | null
  role: Role
  is_active: boolean
  created_at: string | null
  updated_at: string | null
}

export interface Project {
  id: string
  code: string
  name: string
  description: string | null
  status: string | null
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
