// One shape for every Telegram text card, so the eye knows where to look
// before it reads (Aksha's picks, 14 Oct 2026):
//
//   why you got it      "Needs you · Atm Head for SRAH" or "For your record"
//   the fact            one bold line, plain words, an icon for the kind of event
//   the figure          project · item · amount, Indian grouping, the biggest text
//   what happens next   the one action expected, or "Nothing for you to do"
//   who and when        name and IST time, last
//   buttons             ✓ Seen (marks it read in CT Hub) + the one place to open
//
// Pure: takes the notification row as notify_user stored it (type, title,
// body, data, url) plus the recipient's role, returns Telegram HTML and an
// inline keyboard. Every type that reached a phone in the last 90 days has its
// own composer below, built from the structured `data` the producer stored;
// anything else falls back to title + body in the same frame, so a new type
// is never worse than before. Nothing here touches the database.

import { NEWS_TYPES } from '@/lib/notifications/bucket'

export interface TelegramNotice {
  /** notifications.id — needed for the ✓ Seen button; omit and the button is left out. */
  id?: string | null
  type: string | null | undefined
  title: string
  body: string
  /** Absolute link for the open button (already resolved against the app origin). */
  url?: string | null
  data?: Record<string, unknown> | null
  /** profiles.role of the recipient, as the database spells it. */
  role?: string | null
}

export interface TelegramButton { text: string; url?: string; callback_data?: string }

export interface TelegramMessage {
  /** Telegram HTML (parse_mode = HTML). */
  html: string
  keyboard: TelegramButton[][]
}

/** callback_data prefix for the ✓ Seen button: "seen:<notification uuid>". */
export const SEEN_PREFIX = 'seen'

/** Types the admin's picks send as TEXT even though they read like reports. */
const TEXT_EVEN_IF_REPORT = new Set(['cc_approval_reminders'])
export function prefersText(type: string | null | undefined): boolean {
  return TEXT_EVEN_IF_REPORT.has((type ?? '').toLowerCase())
}

// ── small helpers ───────────────────────────────────────────────────────────

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
const b = (s: unknown) => `<b>${esc(s)}</b>`
const i = (s: unknown) => `<i>${esc(s)}</i>`
const q = (s: unknown) => `“${esc(String(s ?? '').trim())}”`

/** A bill's hub number — WCE-9, NGHA-7 (15 Oct 2026). The producer stores it
 *  in data.serial and leads the title with it; either is enough. */
const HUB_NO = /^([A-Z][A-Z0-9]*-\d+) · /
function hubNo(n: TelegramNotice, d: Record<string, unknown>): string | null {
  const fromData = typeof d.serial === 'string' && d.serial.trim() ? d.serial.trim() : null
  return fromData ?? n.title.match(HUB_NO)?.[1] ?? null
}
/** The title with its hub-number prefix removed, for composers that read it. */
const untagged = (title: string) => title.replace(HUB_NO, '')

/** ₹ with Indian grouping, no paise: ₹3,29,220. */
export function inr(n: unknown): string {
  const v = Math.round(Number(n) || 0)
  return '₹' + Math.abs(v).toLocaleString('en-IN') .replace(/^/, v < 0 ? '-' : '')
}
/** ₹ in lakh / crore for the big project totals: ₹1.86 Cr, ₹10.07 L. */
export function inrShort(n: unknown): string {
  const v = Number(n) || 0
  const a = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)} Cr`
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)} L`
  return inr(v)
}

/** "NGH C · NGH C" and "CV4 CV4" collapse to one name. */
export function projectLabel(s: unknown): string {
  const t = String(s ?? '').trim()
  if (!t) return ''
  const dot = t.split(' · ').map(x => x.trim()).filter(Boolean)
  if (dot.length === 2 && dot[0].toLowerCase() === dot[1].toLowerCase()) return dot[0]
  const halves = t.split(' ')
  if (halves.length % 2 === 0) {
    const h = halves.length / 2
    if (halves.slice(0, h).join(' ').toLowerCase() === halves.slice(h).join(' ').toLowerCase()) return halves.slice(0, h).join(' ')
  }
  return t
}

/** VEER BALAJI ENTERPRISES → Veer Balaji Enterprises; leaves mixed case alone.
 *  Words of one or two letters (MM, C V) stay as they are. */
export function niceName(s: unknown): string {
  const t = String(s ?? '').trim()
  const lower = (t.match(/[a-z]/g) ?? []).length
  if (!t || lower > 1) return t
  return t.split(/(\s+)/).map(w => {
    if (!/[A-Za-z]/.test(w) || w.replace(/[^A-Za-z]/g, '').length <= 2) return w
    return w.toLowerCase().replace(/(^|[(/-])([a-z])/g, (_, p, c) => p + c.toUpperCase())
  }).join('')
}

const ROLE_LABEL: Record<string, string> = {
  founder: 'Trustee', head: 'Atm Head', project_head: 'Project Head', admin: 'Admin',
  billing: 'CT Billing', coordinator: 'Coordinator', engineer: 'Engineer', hop: 'HOP',
  store_manager: 'Store', backoffice: 'Back office', backoffice_backup: 'Back office',
}
export function roleLabel(role: string | null | undefined): string | null {
  return role ? (ROLE_LABEL[role] ?? null) : null
}

/** 25 Sept, 11:40 am — IST, whatever the server's clock zone. */
export function whenIST(v: unknown, withTime = true): string {
  if (!v) return ''
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  }).replace(',', ',')
}

function str(d: Record<string, unknown> | null | undefined, k: string): string | null {
  const v = d?.[k]
  return v == null || String(v).trim() === '' ? null : String(v).trim()
}
function num(d: Record<string, unknown> | null | undefined, k: string): number | null {
  const v = d?.[k]
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// ── the frame ───────────────────────────────────────────────────────────────

interface Parts {
  /** false = "For your record"; true = "Needs you". */
  needsYou: boolean
  /** Extra context after the role: "for SRAH". */
  project?: string | null
  title: string
  /** Already-escaped HTML lines (use b()/i()/q()/esc()). Empty strings are skipped. */
  lines: string[]
  next?: string | null
  meta?: string | null
  /** Label of the open button; the link is the notice's url. */
  open?: string | null
  /** Extra buttons on the open row, after Seen. */
  more?: TelegramButton[]
  /** Leave the ✓ Seen button out (the message has its own action buttons). */
  noSeen?: boolean
}

function frame(n: TelegramNotice, p: Parts): TelegramMessage {
  const role = roleLabel(n.role)
  const who = [p.needsYou ? 'Needs you' : 'For your record', role].filter(Boolean).join(' · ')
    + (p.project ? ` for ${p.project}` : '')
  const out: string[] = [i(who), b(p.title)]
  for (const l of p.lines) if (l) out.push(l)
  if (p.next) { out.push(''); out.push(b(p.next)) }
  if (p.meta) out.push(i(p.meta))
  const keyboard: TelegramButton[][] = []
  const row: TelegramButton[] = []
  if (n.id && !p.noSeen) row.push({ text: '✓ Seen', callback_data: `${SEEN_PREFIX}:${n.id}` })
  if (n.url) row.push({ text: p.open || 'Open in CT Hub', url: n.url })
  if (row.length) keyboard.push(row)
  if (p.more && p.more.length) keyboard.push(p.more)
  return { html: out.join('\n'), keyboard }
}

// ── per-type composers ──────────────────────────────────────────────────────

type Composer = (n: TelegramNotice, d: Record<string, unknown>) => TelegramMessage

const approvalPending: Composer = (n, d) => {
  const project = projectLabel(str(d, 'project'))
  const work = str(d, 'work') ?? ''
  const amount = num(d, 'amount')
  const note = str(d, 'note'); const noteBy = str(d, 'note_by')
  // A return also fires this event (to admins). Say what it is.
  const ret = n.body.match(/^(.*?) returned a .*→ returned\)/)
  if (ret) {
    return frame(n, {
      needsYou: false, project,
      title: `🔁 Budget returned by ${ret[1].trim()}`,
      lines: [
        [esc(project), esc(work), amount != null ? b(inr(amount)) : ''].filter(Boolean).join(' · '),
        note ? `${noteBy ? esc(noteBy) + ': ' : ''}${q(note)}` : '',
      ],
      next: 'Nothing for you to do. The engineer fixes it and resubmits.',
      meta: str(d, 'raised_by') ? `Raised by ${str(d, 'raised_by')}` : null,
      open: 'Open the budget',
    })
  }
  const stage = str(d, 'stage_label') ?? 'sign-off'
  const perSft = num(d, 'per_sft')
  const erp = num(d, 'project_erp_budget')
  const already = num(d, 'already_approved'); const cumulative = num(d, 'cumulative')
  const waiting = num(d, 'waiting_days') ?? 0
  const lines = [
    [esc(project), esc(work), amount != null ? b(inr(amount)) : ''].filter(Boolean).join(' · ') + (perSft ? ` · ${esc(inr(perSft))}/sft` : ''),
    str(d, 'category') ? esc(str(d, 'category')) : '',
    erp ? i(`Project budget in IN4 ${inrShort(erp)}`) : '',
    already != null && already > 0 ? i(`Already approved ${inr(already)} · this version ${inr(cumulative ?? amount)}`) : '',
    note ? `${noteBy ? esc(noteBy) + ': ' : ''}${q(note)}` : '',
  ]
  return frame(n, {
    needsYou: true, project,
    title: `🟠 Budget waiting for your ${stage}`,
    lines,
    next: /release/i.test(stage) ? 'Release or return in CT Hub.' : 'Approve or return in CT Hub.',
    meta: [str(d, 'raised_by') ? `Raised by ${str(d, 'raised_by')}` : '', waiting > 0 ? `waiting ${waiting}d` : ''].filter(Boolean).join(' · ') || null,
    open: 'Open the budget',
  })
}

const approvalReminders: Composer = (n, d) => {
  const items = (Array.isArray(d.items) ? d.items : []) as Array<Record<string, unknown>>
  const mine = num(d, 'mine') ?? 0
  const total = num(d, 'total') ?? items.reduce((s, x) => s + (Number(x.amount) || 0), 0)
  const oldest = items.reduce((m, x) => Math.max(m, Number(x.days) || 0), 0)
  const byProject = new Map<string, Array<Record<string, unknown>>>()
  for (const it of items) {
    const p = projectLabel(str(it, 'project')) || 'Project'
    byProject.set(p, [...(byProject.get(p) ?? []), it])
  }
  const lines: string[] = []
  for (const [p, list] of byProject) {
    const parts = list.map(x => `${esc(str(x, 'label') ?? 'budget')} ${esc(inr(x.amount))} · ${Number(x.days) || 0}d${x.escalated ? ' ⚠' : ''}`)
    lines.push(`${b(p)} · ${parts.join('; ')}`)
  }
  const count = num(d, 'count') ?? items.length
  const needsYou = mine > 0
  const roleProject = null
  const msg = frame(n, {
    needsYou, project: roleProject,
    title: needsYou ? '🟠 Still waiting on you' : '⏳ Stuck with someone else, copied to you',
    lines,
    next: needsYou ? 'Approve or return each.' : 'None of these need your approval. Chase them if you like.',
    open: 'Open approvals',
  })
  // The why line carries the numbers for this one: "Needs you · 5 budgets, ₹5.03 Cr, oldest 24 days".
  const who = `${needsYou ? 'Needs you' : 'For your record'} · ${count} budget${count === 1 ? '' : 's'}, ${inrShort(total)}, oldest ${oldest} day${oldest === 1 ? '' : 's'}`
  return { ...msg, html: msg.html.replace(/^<i>[^\n]*<\/i>/, i(who)) }
}

const in4Entered: Composer = (n, d) => {
  const project = projectLabel(str(d, 'project'))
  return frame(n, {
    needsYou: false, project,
    title: '✅ Entered in IN4',
    lines: [
      [esc(project), esc(str(d, 'work') ?? '')].filter(Boolean).join(' · '),
      b(inr(d.amount)) + (str(d, 'ref') ? i(` · ref: ${str(d, 'ref')}`) : ''),
    ],
    next: 'Nothing for you to do. The Work Order can now proceed.',
    open: 'View working sheet',
  })
}

const budgetApproved: Composer = (n, d) => {
  const project = projectLabel(str(d, 'project'))
  const perSft = num(d, 'per_sft')
  return frame(n, {
    needsYou: false, project,
    title: '✅ Trustee approved the budget',
    lines: [[esc(project), esc(str(d, 'work') ?? ''), b(inr(d.amount))].filter(Boolean).join(' · ') + (perSft ? ` · ${esc(inr(perSft))}/sft` : '')],
    next: 'Next: CT Billing enters it in IN4. One more message when that is done.',
    open: 'View working sheet',
  })
}

const grnReceived: Composer = (n, d) => {
  const mats = (str(d, 'materials') ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const first = mats[0] ? niceName(mats[0]) : 'Material'
  const more = mats.length > 1 ? ` +${mats.length - 1} more item${mats.length - 1 === 1 ? '' : 's'}` : ''
  const qty = num(d, 'qty')
  return frame(n, {
    needsYou: false,
    title: '📦 Material received',
    lines: [
      b(first) + esc(more),
      b([qty ? `${qty.toLocaleString('en-IN')} units` : '', inr(d.value)].filter(Boolean).join(' · ')),
      i([str(d, 'ref'), str(d, 'po') ? `against ${str(d, 'po')}` : ''].filter(Boolean).join(' · ')),
    ],
    next: 'Nothing for you to do.',
    meta: [str(d, 'supplier') ? `From ${niceName(str(d, 'supplier'))}` : '', whenIST(d.date, false)].filter(Boolean).join(' · ') || null,
    open: 'Open procurement',
  })
}

/** "Electrical Works · 15 items · ok" → the category and the count; a remark
 *  only when it says something (IN4 fills it with "ok", "k", "App"). */
function indentWhat(what: string | null): string[] {
  if (!what) return []
  const parts = what.split(' · ').map(s => s.trim()).filter(Boolean)
  return parts.filter((p, idx) => idx < 2 || p.length >= 8)
}

const in4Verify: Composer = (n, d) => {
  const kind = str(d, 'kind') ?? (n.type ?? '').replace('in4_', '').replace('_verify', '')
  const ref = str(d, 'ref') ?? ''
  const who = str(d, 'who'); const since = str(d, 'since'); const status = str(d, 'status') ?? 'Verify'
  const meta = [`Reached ${status}${since ? ' ' + whenIST(since, false) : ''}`, who ? `raised by ${who}` : ''].filter(Boolean).join(' · ')
  if (kind === 'indent') {
    const what = indentWhat(str(d, 'what'))
    return frame(n, {
      needsYou: true,
      title: '🟠 Indent waiting for your approval in IN4',
      lines: [
        b(ref) + (what.length ? ' · ' + esc(what.slice(0, 2).join(' · ')) : ''),
        what[2] ? i(what[2]) : '',
        str(d, 'context') ? i(str(d, 'context')) : '',
      ],
      next: 'Open IN4 and verify it.',
      meta, open: 'Open procurement',
    })
  }
  if (kind === 'wo') {
    const ctx = str(d, 'context') ?? ''
    const [cat, ...rest] = ctx.split(' · ')
    const desc = rest.join(' · ').trim()
    return frame(n, {
      needsYou: true,
      title: '🟠 Work order waiting for your approval in IN4',
      lines: [
        b(ref),
        [esc(niceName(str(d, 'contractor') ?? str(d, 'what'))), b(inr(d.value)), cat && !desc ? esc(cat) : cat].filter(Boolean).join(' · '),
        desc ? i(desc.length > 90 ? desc.slice(0, 89).trimEnd() + '…' : desc) : '',
      ],
      next: 'Open IN4 and verify it. The WO / PO tab shows each rate against the last one paid.',
      meta, open: 'Rates vs last paid',
    })
  }
  return frame(n, {
    needsYou: true,
    title: '🟠 PO waiting for your approval in IN4',
    lines: [
      b(ref),
      [esc(niceName(str(d, 'supplier') ?? str(d, 'what'))), b(inr(d.value))].filter(Boolean).join(' · '),
      str(d, 'context') ? i(str(d, 'context')!.replace(/^for /, 'for indent ')) : '',
    ],
    next: 'Open IN4 and verify it.',
    meta, open: 'Open procurement',
  })
}

const budgetTransfer: Composer = (n, d) => {
  const t = n.title.match(/^(₹[\d,.]+(?:\s?(?:Cr|L))?) moved inside (.+?) · (.+)$/)
  const m = n.body.match(/moved from (.+?) to (.+?) in IN4/)
  const amount = str(d, 'amount') ? inr(d.amount) : (t?.[1] ?? '')
  const cat = str(d, 'category') ?? t?.[2] ?? ''
  const project = projectLabel(str(d, 'project') ?? t?.[3] ?? '')
  const from = str(d, 'from') ?? m?.[1] ?? ''
  const to = str(d, 'to') ?? m?.[2] ?? ''
  return frame(n, {
    needsYou: false, project,
    title: `↔ ${amount} moved inside ${cat}`.trim(),
    lines: [
      from && to ? `${esc(from)} → ${esc(to)}` : esc(n.body),
      i('Category total unchanged. Internal transfer in IN4, not a new approval.'),
    ],
    next: 'Nothing for you to do.',
    open: 'View project',
  })
}

const accessRequest: Composer = (n) => {
  const name = n.body.replace(/\s+signed in.*$/i, '').trim() || 'Someone'
  return frame(n, {
    needsYou: true,
    title: '👤 New access request',
    lines: [b(name), i('Signed in, no role yet')],
    next: 'Approve, or open Users to set a role.',
    open: 'Open Users',
  })
}

const whRequest: Composer = (n, d) => {
  const items = num(d, 'items') ?? 1
  const who = n.title.match(/— (.+?) needs your approval/)?.[1] ?? null
  const sentences = n.body.split(/(?<=\.)\s+/).map(s => s.trim()).filter(Boolean)
  const extra = sentences.slice(1).join(' ')
  const reqNo = (str(d, 'reqNo') ?? '').replace(/^Rq:\s*/i, '')
  return frame(n, {
    needsYou: true,
    title: '🧱 Material request waiting for you',
    lines: [
      `${b(`${items} item${items === 1 ? '' : 's'}`)}${str(d, 'store') ? ` from ${esc(str(d, 'store'))}` : ''}${str(d, 'project') ? ` · for ${esc(str(d, 'project'))}` : ''}`,
      extra ? i(extra) : '',
    ],
    next: 'Approve or reject it.',
    meta: [reqNo ? `Request ${reqNo}` : '', who ? `by ${who}` : ''].filter(Boolean).join(' · ') || null,
    open: 'View request',
  })
}

const sanctionMatched: Composer = (n, d) => {
  const by = n.body.match(/Entered by (.+?)\./)?.[1] ?? null
  const hub = hubNo(n, d)
  return frame(n, {
    needsYou: false,
    title: '✅ Sanction matched IN4',
    lines: [[hub ? b(hub) : '', esc(str(d, 'certificate') ?? ''), b(inr(d.sanctioned))].filter(Boolean).join(' · '), i('Exactly what was sanctioned')],
    next: 'Nothing for you to do.',
    meta: by ? `Entered by ${by}` : null,
    open: 'View sanctions',
  })
}

const sanctionMismatch: Composer = (n, d) => {
  const by = n.body.match(/Entered by (.+?)\./)?.[1] ?? null
  const diff = num(d, 'difference') ?? ((num(d, 'in4') ?? 0) - (num(d, 'sanctioned') ?? 0))
  const hub = hubNo(n, d)
  return frame(n, {
    needsYou: true,
    title: '🔴 Sanction does not match IN4',
    lines: [
      [hub ? b(hub) : '', esc(str(d, 'certificate') ?? '')].filter(Boolean).join(' · '),
      `Sanctioned ${b(inr(d.sanctioned))} · IN4 says ${b(inr(d.in4))}`,
      b(`${inr(Math.abs(diff))} ${diff < 0 ? 'lower' : 'higher'} in IN4`),
    ],
    next: 'Open it and decide.',
    meta: by ? `Entered in IN4 by ${by}` : null,
    open: 'Open the sanction', noSeen: true,
  })
}

const billsVerdict: Composer = (n, d) => {
  const hub = hubNo(n, d)
  const vendor = untagged(n.title).split(' — ')[0]?.trim() ?? ''
  const lines = n.body.split('\n').map(s => s.trim()).filter(Boolean)
  const cert = lines.find(l => /^Certificate /.test(l)) ?? ''
  const figures = lines.find(l => /payable/i.test(l)) ?? ''
  const mfpMissing = lines.find(l => l.startsWith('⚠'))
  const mfpPresent = lines.find(l => l.startsWith('★'))
  const certNo = cert.match(/^Certificate (\S+)/)?.[1] ?? ''
  const approvedBy = cert.match(/ by (.+?)(?: \(| on |\.|$)/)?.[1] ?? null
  const stage = str(d, 'stage')
  const billingDesk = stage === 'ct_billing' || ['billing', 'admin', 'coordinator'].includes(n.role ?? '')
  if (mfpMissing && billingDesk) {
    return frame(n, {
      needsYou: true,
      title: '🔴 MFP line missing on the certificate',
      lines: [
        [hub ? b(hub) : '', esc(certNo), esc(vendor)].filter(Boolean).join(' · '),
        figures ? i(figures.replace(/\.$/, '')) : '',
        i(mfpMissing.includes('blank') ? 'Remark in IN4 is blank' : mfpMissing.replace(/^⚠\s*/, '').split(' — ')[0]),
      ],
      next: 'Add “MFP AS PER COP INSTRUCTION BY …” on the certificate in IN4 before Accounts processes it.',
      meta: approvedBy ? `Approved in IN4 by ${approvedBy}` : null,
      open: 'View bill',
    })
  }
  const differs = /differs/i.test(n.title)
  return frame(n, {
    needsYou: differs,
    title: differs ? '🟠 IN4 approval differs from CT Hub' : '✅ IN4 approval matches CT Hub',
    lines: [
      [hub ? b(hub) : '', esc(certNo), esc(vendor)].filter(Boolean).join(' · '),
      figures ? esc(figures.replace(/\.$/, '')) : '',
      mfpPresent ? i('MFP line is on the certificate') : mfpMissing ? i('No MFP line on the certificate; CT Billing is told') : '',
    ],
    next: differs ? 'Open it and decide.' : 'Nothing for you to do. It now waits with the trust.',
    meta: approvedBy ? `Approved in IN4 by ${approvedBy}` : null,
    open: 'View bill',
  })
}

const mention: Composer = (n, d) => {
  const author = str(d, 'author') ?? n.title.split(' mentioned')[0]
  const comment = (str(d, 'comment') ?? n.body).replace(/^@\S+(?:\s\S+)?\s*/, '').trim()
  return frame(n, {
    needsYou: true,
    title: `💬 ${author} mentioned you`,
    lines: [
      i([str(d, 'context'), str(d, 'module')].filter(Boolean).join(' · ')),
      q(comment || n.body),
    ],
    next: 'Reply in the sheet.',
    open: 'Open the comment',
  })
}

const wsReturned: Composer = (n, d) => {
  const code = str(d, 'ws_code') ?? n.title.split(' · ')[1]?.trim() ?? ''
  const reason = str(d, 'reason') ?? n.body.replace(/^[\s\S]*?Reason:\s*/, '').trim()
  return frame(n, {
    needsYou: true,
    title: '🔁 Your budget was returned',
    lines: [b(code), reason ? q(reason) : ''],
    next: 'Fix it and resubmit.',
    meta: str(d, 'by') ? `Returned by ${str(d, 'by')}` : null,
    open: 'Open the sheet',
  })
}

const trusteeReturned: Composer = (n, d) => {
  const project = projectLabel(str(d, 'project'))
  return frame(n, {
    needsYou: false, project,
    title: '🔁 Trustee returned a budget',
    lines: [
      [esc(project), esc(str(d, 'work') ?? str(d, 'ws_code') ?? ''), num(d, 'amount') != null ? b(inr(d.amount)) : ''].filter(Boolean).join(' · '),
      str(d, 'reason') ? q(str(d, 'reason')) : esc(n.body),
    ],
    next: 'Nothing for you to do now. The engineer fixes it and resubmits, and it comes back to you for sign-off.',
    meta: [str(d, 'by') ? `Returned by ${str(d, 'by')}` : '', str(d, 'raised_by') ? `raised by ${str(d, 'raised_by')}` : ''].filter(Boolean).join(' · ') || null,
    open: 'View working sheet',
  })
}

const COMPOSERS: Record<string, Composer> = {
  approval_pending: approvalPending,
  cc_approval_reminders: approvalReminders,
  in4_entered: in4Entered,
  cc_budget_approved: budgetApproved,
  in4_grn_received: grnReceived,
  in4_indent_verify: in4Verify,
  in4_po_verify: in4Verify,
  in4_wo_verify: in4Verify,
  cc_budget_transfer: budgetTransfer,
  access_request: accessRequest,
  wh_request_raised: whRequest,
  bills_sanction_matched: sanctionMatched,
  bills_sanction_mismatch: sanctionMismatch,
  bb_in4_verdict: billsVerdict,
  comment_mention: mention,
  cc_ws_returned: wsReturned,
  cc_trustee_returned: trusteeReturned,
}

/** Everything else: the same frame around the producer's own title and body. */
function fallback(n: TelegramNotice): TelegramMessage {
  const type = n.type ?? ''
  return frame(n, {
    needsYou: !NEWS_TYPES.has(type),
    title: n.title || 'CT Hub',
    lines: n.body ? n.body.split('\n').map(l => esc(l)) : [],
    open: 'Open in CT Hub',
  })
}

/** The Telegram text card for one notification. Never throws: a composer that
 *  trips on odd data falls back to the plain frame. */
export function composeTelegram(n: TelegramNotice): TelegramMessage {
  const type = (n.type ?? '').toLowerCase()
  const c = COMPOSERS[type]
  if (!c) return fallback(n)
  try {
    const d = (n.data && typeof n.data === 'object' && !Array.isArray(n.data)) ? n.data : {}
    return c(n, d)
  } catch {
    return fallback(n)
  }
}

/** The keyboard for a picture card (reports): ✓ Seen beside the open button. */
export function cardKeyboard(n: TelegramNotice, open = 'Open in CT Hub'): TelegramButton[][] {
  const row: TelegramButton[] = []
  if (n.id) row.push({ text: '✓ Seen', callback_data: `${SEEN_PREFIX}:${n.id}` })
  if (n.url) row.push({ text: open, url: n.url })
  return row.length ? [row] : []
}
