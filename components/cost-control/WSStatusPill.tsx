import { Badge } from '@/components/ui/badge'

export type WSStatus =
  | 'draft' | 'draft_blocked' | 'submitted' | 'ph_approved' | 'atm_approved'
  | 'partially_approved' | 'approved' | 'returned' | 'wo_issued' | 'paid' | 'cancelled'

const LABEL: Record<WSStatus, string> = {
  draft:              'Draft',
  draft_blocked:      'Blocked',
  submitted:          'With Project Head',
  ph_approved:        'With Atm Head',
  atm_approved:       'With Trustee',
  partially_approved: 'Partly released',
  approved:           'Approved',
  returned:           'Returned',
  wo_issued:          'WO issued',
  paid:               'Paid',
  cancelled:          'Cancelled',
}

const VARIANT: Record<WSStatus, 'default' | 'success' | 'warning' | 'secondary' | 'destructive'> = {
  draft:              'secondary',
  draft_blocked:      'warning',
  submitted:          'default',
  ph_approved:        'default',
  atm_approved:       'default',
  partially_approved: 'warning',
  approved:           'success',
  returned:           'destructive',
  wo_issued:          'success',
  paid:               'success',
  cancelled:          'secondary',
}

/** Human label for a WS status — for prose like "Sheet is locked — status
 *  is WO issued". Unknown values degrade to "Some status" rather than raw
 *  snake_case, so new DB statuses never leak to users. */
export function wsStatusLabel(status: string): string {
  const known = LABEL[status as WSStatus]
  if (known) return known
  const words = (status ?? '').replace(/_/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Unknown'
}

export function WSStatusPill({ status }: { status: WSStatus }) {
  return <Badge variant={VARIANT[status] ?? 'secondary'}>{wsStatusLabel(status)}</Badge>
}
