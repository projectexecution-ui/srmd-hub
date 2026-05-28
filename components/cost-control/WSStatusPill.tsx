import { Badge } from '@/components/ui/badge'

export type WSStatus =
  | 'draft' | 'draft_blocked' | 'submitted' | 'partially_approved' | 'approved'
  | 'returned' | 'wo_issued' | 'paid' | 'cancelled'

const LABEL: Record<WSStatus, string> = {
  draft:              'Draft',
  draft_blocked:      'Blocked',
  submitted:          'Submitted',
  partially_approved: 'Partially approved',
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
  partially_approved: 'warning',
  approved:           'success',
  returned:           'destructive',
  wo_issued:          'success',
  paid:               'success',
  cancelled:          'secondary',
}

export function WSStatusPill({ status }: { status: WSStatus }) {
  return <Badge variant={VARIANT[status]}>{LABEL[status]}</Badge>
}
