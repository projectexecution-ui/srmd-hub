// Mayank's daily "stuck bills — your worklist" email. Turns the big stuck-bill
// snapshot + the 4-doc verification checklist into a prioritised, fixed-length
// to-do: quick wins first, then biggest-money/oldest, then batch-chase gaps.
// Pure (no Supabase/React) so the cron just feeds it data.

export interface WorklistBill {
  id: string
  vendor: string
  project: string
  invoiceNo: string
  status: string
  amount: number
  delayDays: number
  stalled: boolean
}
export interface WorklistCheck {
  ms_sheet: boolean
  abstract_sheet: boolean
  po_wo: boolean
  drawing: boolean
}

const DOCS: Array<{ key: keyof WorklistCheck; label: string }> = [
  { key: 'ms_sheet', label: 'MS' },
  { key: 'abstract_sheet', label: 'Abstract' },
  { key: 'po_wo', label: 'PO/WO' },
  { key: 'drawing', label: 'Drawing' },
]
const EMPTY: WorklistCheck = { ms_sheet: false, abstract_sheet: false, po_wo: false, drawing: false }

function inr(n: number): string {
  const v = Math.round(n || 0); const s = Math.abs(v).toString(); const neg = v < 0 ? '-' : ''
  if (s.length <= 3) return neg + s
  return neg + s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3)
}
function cr(n: number): string {
  if (n >= 1e7) return '₹' + (n / 1e7).toFixed(2) + ' Cr'
  if (n >= 1e5) return '₹' + (n / 1e5).toFixed(1).replace(/\.0$/, '') + ' L'
  return '₹' + inr(n)
}
const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Bills whose current stage is the CT Head desk (not "CT Disc Head" / "CT Billing").
export function isCtHead(status: string): boolean {
  return /(^|[^a-z])ct head\b/i.test((status || '').toLowerCase())
}

function ticks(c: WorklistCheck): number {
  return DOCS.reduce((n, d) => n + (c[d.key] ? 1 : 0), 0)
}
function docChips(c: WorklistCheck, onlyMissing: boolean): string {
  return DOCS.map(d => {
    const ok = c[d.key]
    if (onlyMissing && ok) return ''
    const style = ok
      ? 'color:#0f6e56;background:#ecfdf5;border:1px solid #a7f3d0'
      : 'color:#be123c;background:#fff;border:1px solid #fecdd3'
    return `<span style="display:inline-block;font-size:11px;font-weight:700;border-radius:999px;padding:2px 9px;margin:0 4px 0 0;${style}">${d.label} ${ok ? '✓' : '✗'}</span>`
  }).join('')
}

export interface WorklistResult { subject: string; html: string; count: number }

export function buildStuckWorklist(
  allBills: WorklistBill[],
  checks: Record<string, WorklistCheck>,
  opts: { asOf?: string; dateLabel: string },
): WorklistResult {
  const bills = allBills.filter(b => isCtHead(b.status))
  const get = (id: string) => checks[id] ?? EMPTY

  const total = bills.length
  const totalValue = bills.reduce((s, b) => s + (b.amount || 0), 0)
  const ready = bills.filter(b => ticks(get(b.id)) === 4).length
  const oneAway = bills.filter(b => ticks(get(b.id)) === 3)
  const stalled = bills.filter(b => b.stalled).length

  const gaps = DOCS.map(d => ({ label: d.label, n: bills.filter(b => !get(b.id)[d.key]).length }))

  const chase = [...bills]
    .filter(b => ticks(get(b.id)) < 4)
    .sort((a, b) => (b.amount * (1 + b.delayDays / 20)) - (a.amount * (1 + a.delayDays / 20)))
    .slice(0, 8)

  const bySite = (() => {
    const m = new Map<string, { count: number; value: number }>()
    for (const b of bills) {
      const cur = m.get(b.project || '—') ?? { count: 0, value: 0 }
      cur.count++; cur.value += b.amount || 0; m.set(b.project || '—', cur)
    }
    return [...m.entries()].map(([code, v]) => ({ code, ...v })).sort((a, b) => b.value - a.value).slice(0, 6)
  })()

  // ── HTML (inline styles for mail clients) ──
  const NAVY = '#0f2a4a', GOLD = '#c8a24a', MUTE = '#6b7280', INK = '#1f2937', RED = '#be123c'
  const kpi = (n: string, l: string, col = INK) =>
    `<td style="padding:0 4px"><div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:9px;padding:9px 10px">`
    + `<div style="font-size:19px;font-weight:800;color:${col};line-height:1">${n}</div>`
    + `<div style="font-size:10.5px;color:${MUTE};margin-top:4px;text-transform:uppercase;letter-spacing:.03em">${l}</div></div></td>`

  const billRow = (b: WorklistBill, onlyMissing: boolean, need: string) => {
    const c = get(b.id)
    const stall = b.stalled ? `<span style="display:inline-block;font-size:10.5px;font-weight:700;border-radius:5px;padding:1px 6px;background:#ffe4e6;color:${RED}">STALLED</span>` : ''
    return `<div style="border:1px solid ${b.stalled ? '#fecdd3' : '#e5e7eb'};${b.stalled ? 'background:#fff1f2;' : ''}border-radius:10px;padding:10px 12px;margin-bottom:7px">`
      + `<div><span style="font-weight:700;font-size:13.5px">${esc(b.vendor) || '—'}</span>`
      + `<span style="float:right;font-weight:800;font-size:13.5px">₹${inr(b.amount)}</span></div>`
      + `<div style="font-size:11.5px;color:${MUTE};margin-top:2px">`
      + `<span style="display:inline-block;background:${NAVY};color:#fff;border-radius:5px;padding:1px 6px;font-size:10.5px;font-weight:700">${esc(b.project)}</span> `
      + `Inv ${esc(b.invoiceNo) || '—'} · ${b.delayDays}d ${stall}</div>`
      + `<div style="margin-top:7px"><span style="font-size:11px;color:${MUTE};margin-right:4px">${need}</span>${docChips(c, onlyMissing)}</div>`
      + `</div>`
  }

  const oneAwayHtml = oneAway.length
    ? `<h2 style="font-size:14.5px;margin:22px 0 4px;color:${NAVY}">⚡ One doc away — close these first <span style="color:${MUTE};font-weight:600;font-size:12px">· ${oneAway.length} quick wins</span></h2>`
      + `<p style="font-size:11.5px;color:${MUTE};margin:0 0 8px">Three of four checks done. Get the last document and these are ready to push.</p>`
      + oneAway.slice(0, 6).map(b => billRow(b, true, 'Need only:')).join('')
      + (oneAway.length > 6 ? `<p style="font-size:11.5px;color:${NAVY};font-weight:600;margin:2px 0 0">+ ${oneAway.length - 6} more one-doc-away in the app →</p>` : '')
    : ''

  const chaseHtml = chase.length
    ? `<h2 style="font-size:14.5px;margin:22px 0 4px;color:${NAVY}">🔺 Chase today — biggest money, longest wait <span style="color:${MUTE};font-weight:600;font-size:12px">· top ${chase.length} of ${total}</span></h2>`
      + `<p style="font-size:11.5px;color:${MUTE};margin:0 0 8px">Ranked by ₹ × days waiting. Each shows what&apos;s still missing to verify.</p>`
      + chase.map(b => billRow(b, false, 'Need:')).join('')
      + (total - chase.length > 0 ? `<p style="font-size:11.5px;color:${NAVY};font-weight:600;margin:2px 0 0">+ ${total - chase.length} more at the CT Head desk →</p>` : '')
    : ''

  const gapCell = (g: { label: string; n: number }) =>
    `<td style="padding:0 4px;width:50%"><div style="border:1px solid #e5e7eb;border-radius:9px;padding:10px 12px">`
    + `<span style="font-size:12.5px;color:${INK}">${g.label}</span>`
    + `<span style="float:right;font-weight:800;font-size:16px;color:${RED}">${g.n}</span></div></td>`
  const gapsHtml = `<h2 style="font-size:14.5px;margin:22px 0 4px;color:${NAVY}">📋 Missing across all ${total} <span style="color:${MUTE};font-weight:600;font-size:12px">· batch-chase by document</span></h2>`
    + `<p style="font-size:11.5px;color:${MUTE};margin:0 0 8px">Fastest way to move the whole desk — collect one document type at a time.</p>`
    + `<table style="width:100%;border-collapse:separate;border-spacing:0 6px"><tr>${gaps.slice(0, 2).map(gapCell).join('')}</tr><tr>${gaps.slice(2).map(gapCell).join('')}</tr></table>`

  const siteHtml = bySite.length
    ? `<h2 style="font-size:14.5px;margin:22px 0 6px;color:${NAVY}">🏢 By site</h2>`
      + bySite.map(s => `<div style="display:block;padding:6px 0;border-bottom:1px solid #f1f3f5;font-size:12.5px">`
        + `<span style="display:inline-block;background:${NAVY};color:#fff;border-radius:5px;padding:1px 6px;font-size:10.5px;font-weight:700">${esc(s.code)}</span>`
        + `<span style="float:right;font-weight:700">${s.count} bills · ${cr(s.value)}</span></div>`).join('')
    : ''

  const base = 'https://ct-hub.vercel.app'
  const cta = `<a href="${base}/bills-pipeline" style="display:block;text-align:center;background:${NAVY};color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:13px;border-radius:10px;margin:20px 0 6px">Open the Stuck Bills checklist →</a>`

  const html = `<div style="background:#eef1f5;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:${INK}">`
    + `<div style="max-width:640px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden">`
    + `<div style="background:${NAVY};color:#fff;padding:20px 22px 16px"><div style="font-size:19px;font-weight:700">Bills verification — daily worklist</div>`
    + `<div style="font-size:12.5px;color:#c6d2e0;margin-top:4px">${esc(opts.dateLabel)}${opts.asOf ? ` · as of ${esc(opts.asOf)}` : ''}</div>`
    + `<div style="display:inline-block;margin-top:10px;background:${GOLD};color:${NAVY};font-size:12px;font-weight:800;border-radius:6px;padding:3px 10px">Stage: Under CT Head · all ${total} bills below</div></div>`
    + `<div style="height:3px;background:${GOLD}"></div>`
    + `<div style="padding:18px 22px">`
    + `<p style="font-size:14px;margin:0 0 14px">Good morning, Mayank bhai — every bill below is sitting at <b>your CT Head desk</b>, waiting on you. Prioritised so the biggest, oldest money moves first.</p>`
    + `<table style="width:100%;border-collapse:separate;border-spacing:0;margin:0 -4px"><tr>`
    + kpi(String(total), 'To verify') + kpi(String(ready), 'Ready', '#0f6e56')
    + kpi(String(oneAway.length), 'One doc away', '#b45309') + kpi(String(stalled), 'Stalled >21d', RED)
    + `</tr></table>`
    + `<p style="font-size:11.5px;color:${MUTE};margin:10px 0 0">${cr(totalValue)} held at CT Head.</p>`
    + oneAwayHtml + chaseHtml + gapsHtml + siteHtml + cta
    + `</div>`
    + `<div style="font-size:11px;color:${MUTE};text-align:center;padding:0 22px 20px">Sent every day at 9:00 am · from CT HUB · Bills Pipeline. Ticks &amp; remarks you add there feed tomorrow&apos;s list.</div>`
    + `</div></div>`

  const subject = `Stuck bills (CT Head) — your worklist for ${opts.dateLabel} · ${total} to verify · ${cr(totalValue)}`
  return { subject, html, count: total }
}
