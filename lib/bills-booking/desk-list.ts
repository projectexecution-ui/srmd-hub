/** The desks a bill passes through, and who works them.
 *
 *  Lifted out of the Bills desks page so both that screen and a Bills Approval
 *  project's own page use the same list — two copies of this would be two
 *  different flows that look identical until one of them loses a step.
 *
 *  The keys are stored in `bb_desk_members.desk` and are permanent; only the
 *  labels are display. `erp` is the person who types the bill in, `site_head`
 *  is the engineer on site — what Aksha calls the Eng.
 */
export const DESKS = [
  { key: 'erp',             label: 'ERP entry' },
  { key: 'site_head',       label: 'Site Head (Eng)' },
  { key: 'disc_head_civil', label: 'CT Disc Head — Civil' },
  { key: 'disc_head_mep',   label: 'CT Disc Head — MEP' },
  { key: 'ct_head',         label: 'CT Head' },
  { key: 'ct_billing',      label: 'CT Billing (also Trust / Paid)' },
] as const

export type DeskKey = (typeof DESKS)[number]['key']
