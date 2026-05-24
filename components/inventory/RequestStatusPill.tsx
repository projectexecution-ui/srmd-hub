import { Badge } from '@/components/ui/badge'

type Status =
  | 'DRAFT' | 'PENDING_BACKOFFICE' | 'PENDING_HOP' | 'APPROVED' | 'ISSUED'
  | 'CLOSED' | 'REJECTED_BACKOFFICE' | 'REJECTED_HOP' | 'CANCELLED_BY_ENGINEER'
  | 'EMERGENCY_ISSUED'

const LABEL: Record<Status, string> = {
  DRAFT: 'Draft',
  PENDING_BACKOFFICE: 'Pending: Backoffice',
  PENDING_HOP: 'Pending: HoP',
  APPROVED: 'Approved',
  ISSUED: 'Issued',
  CLOSED: 'Closed',
  REJECTED_BACKOFFICE: 'Rejected by Backoffice',
  REJECTED_HOP: 'Rejected by HoP',
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
