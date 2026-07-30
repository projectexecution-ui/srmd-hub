// Share a group's list as readable text (WhatsApp / email / clipboard) instead
// of a CSV file — what a PM actually forwards to a vendor from a phone.
import type { LineRecord } from './types'

function fmtINR(n: number): string {
  if (n >= 1e7) return `Rs ${(n / 1e7).toFixed(2)} Cr`
  if (n >= 1e5) return `Rs ${(n / 1e5).toFixed(1)} L`
  if (n >= 1e3) return `Rs ${(n / 1e3).toFixed(1)} K`
  return `Rs ${Math.round(n).toLocaleString('en-IN')}`
}
const shortIndent = (no: string) => no.replace('IND/SRASSK/', '').replace('IND/SRET/', '').replace('IND/SRJT/', '')

/** Pending-receipts list for a vendor/indent → a numbered chase message. */
export function buildPendingShareText(title: string, lines: LineRecord[]): string {
  const head = `Pending deliveries — ${title}`
  const body = lines.map((l, i) => {
    const age = l.oldestPoAgeDays ?? l.indentAgeDays ?? 0
    return `${i + 1}. ${l.material} — ${l.pendingQty.toLocaleString('en-IN')} ${l.uom} pending`
      + `${l.pendingValue > 0 ? ` (${fmtINR(l.pendingValue)})` : ''}`
      + ` · ${shortIndent(l.indentNo)}${age ? ` · ${age}d since PO` : ''}`
  }).join('\n')
  const total = lines.reduce((s, l) => s + l.pendingValue, 0)
  return `${head}\n\n${body}\n\n${lines.length} item(s)${total > 0 ? ` · ${fmtINR(total)} outstanding` : ''}\n(via CT HUB)`
}

/** No-PO list for an indent/block → a "please raise PO" message. */
export function buildNeedsPoShareText(title: string, lines: LineRecord[]): string {
  const head = `Materials still needing a PO — ${title}`
  const body = lines.map((l, i) =>
    `${i + 1}. ${l.material} — ${l.indentQty.toLocaleString('en-IN')} ${l.uom}`
    + ` · ${shortIndent(l.indentNo)}${l.indentAgeDays ? ` · ${l.indentAgeDays}d waiting` : ''}`,
  ).join('\n')
  return `${head}\n\n${body}\n\n${lines.length} item(s) awaiting a PO\n(via CT HUB)`
}

/** Native share sheet on mobile; clipboard copy elsewhere. Returns how it went. */
export async function shareOrCopy(title: string, text: string): Promise<'shared' | 'copied' | 'failed'> {
  try {
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string }) => Promise<void> }
    if (typeof nav.share === 'function') {
      await nav.share({ title, text })
      return 'shared'
    }
  } catch {
    // user cancelled the share sheet, or it's unavailable — fall through to copy
  }
  try {
    await navigator.clipboard.writeText(text)
    return 'copied'
  } catch {
    return 'failed'
  }
}
