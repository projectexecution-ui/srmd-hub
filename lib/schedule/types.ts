// Schedule tracker — shared types (mirror the sched_* tables).

export type SchedState = 'planned' | 'in_progress' | 'done' | 'on_hold'
export type FloorStatus = 'not_started' | 'wip' | 'done' | 'na'
export type DrawingStatus =
  | 'requested' | 'wip' | 'received' | 'in_review' | 'gfc' | 'superseded'

export interface SchedItem {
  id: string
  project_id: string
  trade: string
  name: string
  sub: string | null
  cc_discipline_id: string | null
  cc_sub_skill_id: string | null
  seq: number
  plan_start: string | null
  plan_end: string | null
  baseline_start: string | null
  baseline_end: string | null
  locked_at: string | null
  state: SchedState
  pct: number
  qty: number | null
  uom: string | null
  qty_done: number | null
  wo_issued: boolean
  wo_number: string | null
  wo_issued_on: string | null
  owner_user_id: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface SchedProgress {
  id: string
  item_id: string
  location: string
  floor_id: string | null
  status: FloorStatus
  updated_by: string | null
  updated_at: string
}

export interface SchedDrawing {
  id: string
  project_id: string
  item_id: string | null
  number: string | null
  title: string
  discipline: string | null
  status: DrawingStatus
  current_rev: string | null
  consultant: string | null
  target_date: string | null
  received_on: string | null
  gfc_on: string | null
  blocking: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface SchedDrawingRevision {
  id: string
  drawing_id: string
  rev: string
  status: string | null
  issued_on: string | null
  note: string | null
  created_by: string | null
  created_at: string
}

export interface SchedDateChange {
  id: string
  item_id: string
  field: 'plan_start' | 'plan_end'
  from_date: string | null
  to_date: string | null
  reason: string | null
  changed_by: string | null
  created_at: string
}

/** Work-back lead times (days), from app_settings; editable in Settings. */
export interface LeadDays {
  procurement: number  // WO issued must be this many days before site-start
  approval: number     // budget approved before WO
  drawing: number      // drawing ready before budget
}

/** Derived, never stored — what the UI shows as the item's status chip. */
export type DisplayStatus =
  | 'done'
  | 'in_progress'
  | 'behind'
  | 'wo_overdue'
  | 'wo_soon'
  | 'blocked'
  | 'upcoming'
  | 'on_hold'
