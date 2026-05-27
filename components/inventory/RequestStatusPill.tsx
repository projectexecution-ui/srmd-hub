import { Badge } from '@/components/ui/badge'

type Status =
  | 'DRAFT' | 'PENDING_BACKOFFICE' | 'PENDING_HOP' | 'APPROVED' | 'ISSUED'
  | 'CLOSED' | 'REJECTED_BACKOFFICE' | 'REJECTED_HOP' | 'CANCELLED_BY_ENGINEER'
  | 'EMERGENCY_ISSUED'

const LABEL: Record<Status, string> = {
  DRAFT: 'Draft',
  PENDING_BACKOFFICE: 'Pending availability check',
  PENDING_HOP: 'Pending Atm Head approval',
  APPROVED: 'Approved — ready to issue',
  ISSUED: 'Issued — confirm receipt',
  CLOSED: 'Received & closed',
  REJECTED_BACKOFFICE: 'Rejected at availability check',
  REJECTED_HOP: 'Rejected by Atm Head',
  CANCELLED_BY_ENGINEER: 'Cancelled',
  EMERGENCY_ISSUED: 'Emergency authorised',
}

const CLS: Record<Status, string> = {
  DRAFT:                  'bg-gray-100 text-gray-700',
  PENDING_BACKOFFICE:     'bg-amber-100 text-amber-800',
  PENDING_HOP:            'bg-amber-100 text-amber-900',
  APPROVED:               'bg-blue-100 text-blue-800',
  ISSUED:                 'bg-emerald-100 text-emerald-800',
  CLOSED:                 'bg-emerald-50 text-emerald-700',
  REJECTED_BACKOFFICE:    'bg-rose-100 text-rose-800',
  REJECTED_HOP:           'bg-rose-100 text-rose-800',
  CANCELLED_BY_ENGINEER:  'bg-gray-100 text-gray-600',
  EMERGENCY_ISSUED:       'bg-purple-100 text-purple-800',
}

export function RequestStatusPill({ status }: { status: string }) {
  const s = status as Status
  return <Badge className={CLS[s] ?? 'bg-gray-100 text-gray-700'}>{LABEL[s] ?? status}</Badge>
}
