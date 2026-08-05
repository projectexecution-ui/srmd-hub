// Per-project card for the daily digest email. Reuses the module's existing
// "PUSH TODAY" renderer (renderPushCard) so the digest looks exactly like the
// in-app push card — ranked by days waiting, Indian date format (fmtDate),
// navy header + gold accent. Just maps the stored stuck-bill snapshot into a
// PushCardInput.

import { renderPushCard, type PushCardInput } from './render'

export interface DigestBill {
  prefix: string
  vendor: string
  status: string        // internal stage e.g. "Under: Site Head"
  project: string       // billing code
  delayDays: number     // days since Zoho entry (the wait)
  invoiceNo?: string | null
  amount?: number | null
  tasklist?: string | null   // area / site
}

const MAX_ROWS = 20

export async function renderProjectPushCard(
  projectCode: string,
  bills: DigestBill[],
  asOf: string,
  generatedAt: string,
): Promise<Buffer> {
  const rows = [...bills]
    .sort((a, b) => b.delayDays - a.delayDays)
    .slice(0, MAX_ROWS)
    .map(b => ({
      vendor:  b.vendor || '(unnamed)',
      project: b.project || projectCode,
      area:    b.tasklist || '',
      stage:   b.status || '',
      billNo:  b.invoiceNo || b.prefix || '',
      claimed: Number(b.amount ?? 0),
      age:     b.delayDays ?? 0,
      idle:    0,      // not carried in the stuck snapshot
      noWO:    false,  // ditto
      stalled: false,  // ditto — keeps the badge off in the digest
    }))

  const input: PushCardInput = {
    scope: projectCode,
    rank: 'days',        // ranked by days waiting, per Aksha's spec
    asOf,                // rendered Indian-style by the push card's fmtDate()
    generatedAt,
    rows,
  }
  return renderPushCard(input)
}
