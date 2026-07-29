// Premium, email-client-safe HTML for CT HUB notifications.
//
// Pure + table-based (Gmail/Outlook strip flexbox/grid), inline styles only,
// no external assets. Each notification "kind" gets a task-card layout; an
// unknown kind falls back to the plain generic card so every other module
// keeps working unchanged.
//
// The DB passes a structured `data` object per kind (raw numbers); all
// formatting (Indian grouping, Cr/L compaction) happens here.

const BRAND = '#185FA5'
const INK = '#111827'
const MUT = '#6b7280'
const HAIR = '#e5e7eb'
const OK = '#0f6e56'
const OKBG = '#e1f5ee'
const WARN = '#854f0b'
const WARNBG = '#faeeda'
const DANGER = '#a32d2d'
const CARD = '#ffffff'
const PAGE = '#f3f4f6'

export const inr = (n: number): string => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`

/** Compact Indian money: ₹1.44 Cr / ₹68.9 L / ₹6,500. */
export function crL(n: number): string {
  const v = Math.round(Number(n) || 0)
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2).replace(/\.00$/, '')} Cr`
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(1).replace(/\.0$/, '')} L`
  return inr(v)
}

function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function button(label: string, link: string): string {
  return `<a href="${esc(link)}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-size:14px;font-weight:500;padding:11px 20px;border-radius:9px;font-family:Arial,Helvetica,sans-serif">${esc(label)} →</a>`
}

function chip(text: string, fg: string, bg: string): string {
  return `<span style="display:inline-block;font-size:12px;font-weight:500;color:${fg};background:${bg};padding:5px 11px;border-radius:8px;font-family:Arial,Helvetica,sans-serif;margin:0 6px 6px 0">${esc(text)}</span>`
}

function shell(inner: string, footer?: string): string {
  return `<!doctype html><html><body style="margin:0;background:${PAGE};padding:24px;font-family:Arial,Helvetica,sans-serif;color:${INK}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:${CARD};border:1px solid ${HAIR};border-radius:14px;overflow:hidden">
    <tr><td style="padding:14px 22px;border-bottom:1px solid ${HAIR}">
      <table role="presentation" width="100%"><tr>
        <td style="font-size:13px;font-weight:500;color:${MUT}">
          <span style="display:inline-block;width:24px;height:24px;line-height:24px;text-align:center;background:${BRAND};color:#fff;border-radius:6px;font-size:11px;vertical-align:middle;margin-right:8px">CT</span>CT HUB · Internal estimate
        </td>
      </tr></table>
    </td></tr>
    ${inner}
  </table>
  ${footer ? `<div style="width:560px;max-width:100%;font-size:11px;color:${MUT};padding:12px 4px;text-align:left">${footer}</div>` : ''}
</td></tr></table>
</body></html>`
}

function row(cells: string): string {
  return `<tr>${cells}</tr>`
}

// ── Approval needed ──────────────────────────────────────────────────────
interface ApprovalData {
  amount?: number
  per_sft?: number | null
  stage_label?: string        // e.g. "Atm Head sign-off"
  stage_index?: number        // 1..4 current stage
  project?: string
  work?: string
  raised_by?: string | null
  waiting_days?: number
  estimate?: number | null    // internal estimate baseline for the sub-skill
  already_approved?: number | null  // prior approved version's total (cumulative flow)
  cumulative?: number | null        // full BOQ total this version
  note?: string | null        // the note that came with this action (why the budget is needed / what changed)
  note_by?: string | null     // who wrote that note
  ai?: { ok: boolean; label: string } | null
}

const STAGES = ['Engineer', 'Project head', 'Atm head', 'Trustee']

function stageTracker(current: number): string {
  const cells = STAGES.map((label, i) => {
    const n = i + 1
    const done = n < current
    const cur = n === current
    const bg = done ? OK : cur ? BRAND : '#f1f0ea'
    const fg = done || cur ? '#ffffff' : MUT
    const lblColor = cur ? BRAND : MUT
    const mark = done ? '✓' : String(n)
    return `<td align="center" width="25%" style="font-family:Arial,Helvetica,sans-serif">
      <div style="width:24px;height:24px;line-height:24px;border-radius:50%;background:${bg};color:${fg};font-size:12px;font-weight:500;margin:0 auto">${mark}</div>
      <div style="font-size:10px;color:${lblColor};margin-top:5px;${cur ? 'font-weight:500' : ''}">${esc(label)}${cur ? ' · you' : ''}</div>
    </td>`
  }).join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table>`
}

function budgetBar(ask: number, estimate: number): string {
  const pct = estimate > 0 ? Math.min(100, Math.round((ask / estimate) * 100)) : 0
  const over = ask > estimate
  const fill = over ? DANGER : OK
  const diff = Math.abs(estimate - ask)
  const diffPct = estimate > 0 ? Math.round((diff / estimate) * 100) : 0
  const note = over
    ? `<span style="color:${DANGER}">▲ ${crL(diff)} (${diffPct}%) over the internal estimate</span>`
    : `<span style="color:${OK}">${crL(diff)} (${diffPct}%) under the internal estimate — headroom left</span>`
  return `<tr><td style="padding:14px 22px 4px">
    <table role="presentation" width="100%"><tr>
      <td style="font-size:11px;color:${MUT}">Engineer's ask</td>
      <td align="right" style="font-size:11px;color:${MUT}">Internal estimate · ${crL(estimate)}</td>
    </tr></table>
    <div style="height:10px;background:#f1f0ea;border-radius:6px;overflow:hidden;margin-top:6px">
      <div style="height:10px;width:${over ? 100 : pct}%;background:${fill};border-radius:6px"></div>
    </div>
    <div style="font-size:11px;margin-top:5px">${note}</div>
  </td></tr>`
}

function factGrid(items: Array<[string, string]>): string {
  const rows: string[] = []
  for (let i = 0; i < items.length; i += 2) {
    const a = items[i], b = items[i + 1]
    rows.push(row(
      `<td width="50%" style="padding:12px 0;border-top:1px solid ${HAIR};font-family:Arial,Helvetica,sans-serif"><div style="font-size:11px;color:${MUT}">${esc(a[0])}</div><div style="font-size:13px;color:${INK};margin-top:2px">${esc(a[1])}</div></td>` +
      (b ? `<td width="50%" style="padding:12px 0 12px 16px;border-top:1px solid ${HAIR};font-family:Arial,Helvetica,sans-serif"><div style="font-size:11px;color:${MUT}">${esc(b[0])}</div><div style="font-size:13px;color:${INK};margin-top:2px">${esc(b[1])}</div></td>` : `<td width="50%"></td>`)
    ))
  }
  return `<tr><td style="padding:0 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join('')}</table></td></tr>`
}

function renderApproval(d: ApprovalData, link: string): string {
  const amount = Number(d.amount ?? 0)
  const waiting = d.waiting_days ?? 0
  const waitChip = waiting > 0
    ? `<td align="right"><span style="font-size:11px;font-weight:500;color:${waiting >= 3 ? DANGER : WARN};background:${WARNBG};padding:4px 10px;border-radius:20px">Waiting ${waiting} day${waiting === 1 ? '' : 's'}</span></td>`
    : ''
  const chips = [
    d.ai ? chip(`AI check · ${d.ai.label}`, d.ai.ok ? OK : WARN, d.ai.ok ? OKBG : WARNBG) : '',
    (d.estimate != null && d.estimate > 0)
      ? (amount > d.estimate ? chip('Over internal estimate', DANGER, '#fceceb') : chip('Within internal estimate', OK, OKBG))
      : '',
  ].join('')

  // The note that came with the action (submit / sign-off) — so the approver
  // sees WHY the budget is needed / what changed, without opening the app.
  const noteText = d.note ? String(d.note).trim() : ''
  const noteBlock = noteText
    ? `<tr><td style="padding:12px 22px 0">
        <div style="border-left:3px solid ${BRAND};background:#f4f8fc;border-radius:0 8px 8px 0;padding:9px 13px">
          <div style="font-size:11px;color:${MUT};text-transform:uppercase;letter-spacing:.04em">Note${d.note_by ? ' · ' + esc(String(d.note_by)) : ''}</div>
          <div style="font-size:13px;line-height:1.55;color:${INK};margin-top:3px">${esc(noteText).replace(/\n/g, '<br/>')}</div>
        </div>
      </td></tr>`
    : ''

  const inner = `
    <tr><td style="padding:18px 22px 4px">
      <table role="presentation" width="100%"><tr>
        <td style="font-size:12px;color:${MUT};text-transform:uppercase;letter-spacing:.04em">Awaiting your ${esc(d.stage_label ?? 'sign-off')}</td>
        ${waitChip}
      </tr></table>
      <div style="margin-top:6px"><span style="font-size:30px;font-weight:500;color:${INK}">${inr(amount)}</span>${d.per_sft ? `<span style="font-size:13px;color:${MUT};margin-left:10px">${inr(d.per_sft)} / sft</span>` : ''}</div>
    </td></tr>
    ${chips.trim() ? `<tr><td style="padding:10px 22px 0">${chips}</td></tr>` : ''}
    ${(d.already_approved != null && d.already_approved > 0)
      ? `<tr><td style="padding:12px 22px 0"><table role="presentation" width="100%" style="border:1px solid ${HAIR};border-radius:8px;background:${OKBG}"><tr>
           <td style="padding:10px 14px;font-size:12px;color:${MUT}">Already approved<br><span style="font-size:15px;font-weight:600;color:${INK}">${inr(Number(d.already_approved))}</span></td>
           <td style="padding:10px 14px;font-size:12px;color:${MUT}">This ask (new)<br><span style="font-size:15px;font-weight:600;color:${BRAND}">${inr(amount - Number(d.already_approved))}</span></td>
           <td style="padding:10px 14px;font-size:12px;color:${MUT}">Cumulative<br><span style="font-size:15px;font-weight:600;color:${OK}">${inr(Number(d.cumulative ?? amount))}</span></td>
         </tr></table></td></tr>`
      : ''}
    ${noteBlock}
    ${(d.estimate != null && d.estimate > 0) ? budgetBar(amount, d.estimate) : ''}
    <tr><td style="padding:16px 22px 6px">${stageTracker(d.stage_index ?? 3)}</td></tr>
    ${factGrid([
      ['Project', d.project ?? '—'],
      ['Work', d.work ?? '—'],
      ...(d.raised_by ? [['Raised by', d.raised_by] as [string, string]] : []),
    ])}
    <tr><td style="padding:18px 22px;border-top:1px solid ${HAIR}">${button('Review & approve', link)}</td></tr>`
  return shell(inner, `You're an approver on this project in CT HUB · manage alerts in Settings → Notifications`)
}

// ── IN4 follow-up digest ─────────────────────────────────────────────────
interface In4PendingData {
  count?: number
  total_stuck?: number
  items?: Array<{ label: string; amount: number; days: number }>
  more?: number
}

function renderIn4Pending(d: In4PendingData, link: string): string {
  const items = d.items ?? []
  const rows = items.map(it => `<tr>
    <td style="padding:10px 22px;font-size:13px;border-top:1px solid ${HAIR}">${esc(it.label)}</td>
    <td align="right" style="padding:10px 12px;font-size:13px;border-top:1px solid ${HAIR}">${inr(it.amount)}</td>
    <td align="right" style="padding:10px 22px;font-size:13px;border-top:1px solid ${HAIR};color:${it.days >= 6 ? DANGER : WARN};${it.days >= 6 ? 'font-weight:500' : ''}">${it.days}d</td>
  </tr>`).join('')
  const moreRow = d.more && d.more > 0 ? `<tr><td style="padding:10px 22px;font-size:13px;border-top:1px solid ${HAIR};color:${MUT}">+ ${d.more} more</td><td></td><td></td></tr>` : ''
  const inner = `
    <tr><td style="padding:16px 22px 4px">
      <table role="presentation" width="100%"><tr>
        <td>
          <div style="font-size:11px;font-weight:500;color:${WARN};text-transform:uppercase;letter-spacing:.04em">Blocking work orders</div>
          <div style="font-size:17px;font-weight:500;color:${INK};margin-top:4px">${d.count ?? items.length} budget${(d.count ?? items.length) === 1 ? '' : 's'} not yet in IN4</div>
        </td>
        <td align="right" valign="top">
          <div style="font-size:20px;font-weight:500;color:${INK}">${crL(Number(d.total_stuck ?? 0))}</div>
          <div style="font-size:11px;color:${MUT}">stuck before WO</div>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="padding-top:12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}${moreRow}</table></td></tr>
    <tr><td style="padding:16px 22px;border-top:1px solid ${HAIR}">${button('Chase these in Cost Control', link)}</td></tr>`
  return shell(inner)
}

// ── Entered in IN4 ───────────────────────────────────────────────────────
interface In4EnteredData { project?: string; work?: string; amount?: number; ref?: string | null }

function renderIn4Entered(d: In4EnteredData, link: string): string {
  const inner = `
    <tr><td style="padding:18px 22px;border-left:3px solid ${OK}">
      <div style="font-size:12px;font-weight:500;color:${OK}">✓ Entered in IN4</div>
      <div style="font-size:16px;font-weight:500;color:${INK};margin-top:6px">${esc(d.project ?? '')} · ${esc(d.work ?? '')} — ${inr(Number(d.amount ?? 0))} is now in IN4</div>
      <div style="font-size:13px;color:${MUT};margin-top:4px;line-height:1.6">${d.ref ? `Ref ${esc(d.ref)}. ` : ''}The Work Order can now proceed.</div>
      <div style="margin-top:14px">${button('View working sheet', link)}</div>
    </td></tr>`
  return shell(inner)
}

// ── Indent → PO daily reminder digest (per Atm Head) ─────────────────────
interface ProcDigestData {
  projects?: string[]
  needPo?: { count: number; rows: Array<{ indentNo: string; project: string; category: string; items: number; days: number }>; more: number; abandoned: number } | null
  awaiting?: { count: number; value: number; rows: Array<{ indentNo: string; project: string; category: string; vendor: string | null; items: number; poDays: number; value: number }>; more: number } | null
  changes?: { received: number; newPos: number; newNoPo: number } | null
  stale?: { lastUploadAt: string } | null
}

function fmtWhen(iso: string): string {
  try { return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) } catch { return iso }
}

function renderProcurementDigest(d: ProcDigestData, link: string): string {
  const need = d.needPo ?? null
  const aw = d.awaiting ?? null
  const changes = d.changes ?? null
  const stale = d.stale ?? null

  const projChips = (d.projects ?? []).map(p =>
    `<span style="display:inline-block;font-size:11px;font-weight:600;color:${BRAND};background:#e8f0f8;border-radius:20px;padding:4px 10px;margin:0 5px 5px 0">${esc(p)}</span>`).join('')

  const snap = `<tr><td style="padding:14px 22px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="50%" valign="top" style="padding-right:6px"><div style="border:1px solid #f3d7d5;background:#fbeceb;border-radius:12px;padding:12px 13px">
        <div style="font-size:11px;font-weight:600;color:${DANGER}">POs to raise</div>
        <div style="font-size:24px;font-weight:700;color:${INK};margin-top:4px">${need?.count ?? 0}</div>
        <div style="font-size:11px;color:${MUT};margin-top:4px">approved 2+ days, no PO${need?.abandoned ? ` · +${need.abandoned} old to clean up` : ''}</div>
      </div></td>
      <td width="50%" valign="top" style="padding-left:6px"><div style="border:1px solid #f0e0c2;background:${WARNBG};border-radius:12px;padding:12px 13px">
        <div style="font-size:11px;font-weight:600;color:${WARN}">Deliveries pending</div>
        <div style="font-size:24px;font-weight:700;color:${INK};margin-top:4px">${crL(aw?.value ?? 0)}</div>
        <div style="font-size:11px;color:${MUT};margin-top:4px">${aw?.count ?? 0} indents · PO 1 week+</div>
      </div></td>
    </tr></table></td></tr>`

  const changesRow = changes ? `<tr><td style="padding:12px 22px 4px">${[
    changes.received ? chip(`✓ ${changes.received} received`, OK, OKBG) : '',
    changes.newPos ? chip(`✓ ${changes.newPos} new PO${changes.newPos === 1 ? '' : 's'}`, OK, OKBG) : '',
    changes.newNoPo ? chip(`🆕 ${changes.newNoPo} new no-PO`, WARN, WARNBG) : '',
  ].join('')}</td></tr>` : ''

  const needRows = (need?.rows ?? []).map(r => `<tr>
    <td style="padding:9px 22px;border-top:1px solid ${HAIR};font-size:12.5px"><span style="font-weight:600;color:${INK}">${esc(r.indentNo)}</span><div style="font-size:11px;color:${MUT};margin-top:1px">${esc(r.project)} · ${esc(r.category)}</div></td>
    <td align="right" valign="top" style="padding:9px 22px;border-top:1px solid ${HAIR};font-size:12.5px;color:${WARN};white-space:nowrap">${r.days}d</td>
  </tr>`).join('')
  const needMore = need?.more ? `<tr><td colspan="2" style="padding:8px 22px;border-top:1px solid ${HAIR};font-size:12px;color:${MUT}">+ ${need.more} more</td></tr>` : ''
  const abandonedNote = need?.abandoned ? `<tr><td colspan="2" style="padding:10px 22px 2px"><div style="font-size:12px;line-height:1.5;color:${WARN};background:${WARNBG};border-radius:9px;padding:9px 11px">⚠ <b style="color:#6d3f06">${need.abandoned} item(s) have had no PO for 90+ days</b> — likely abandoned, worth a one-time clean-up.</div></td></tr>` : ''
  const sectionA = need ? `
    <tr><td style="padding:16px 22px 2px;border-top:1px solid ${HAIR}"><span style="font-size:15px;font-weight:600;color:${INK}">⏰ Raise a PO</span><div style="font-size:11.5px;color:${MUT};margin-top:2px">Indent approved <b style="color:${WARN}">2+ days ago</b>, still no PO.</div></td></tr>
    ${need.count ? `<tr><td style="padding-top:6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${needRows}${needMore}</table></td></tr>` : ''}
    ${abandonedNote}` : ''

  const awRows = (aw?.rows ?? []).map(r => `<tr>
    <td style="padding:9px 22px;border-top:1px solid ${HAIR};font-size:12.5px"><span style="font-weight:600;color:${INK}">${esc(r.indentNo)}</span><div style="font-size:11px;color:${MUT};margin-top:1px">${esc(r.project)} · ${esc(r.category)}${r.vendor ? ' · ' + esc(r.vendor) : ''}</div></td>
    <td align="right" valign="top" style="padding:9px 8px;border-top:1px solid ${HAIR};font-size:12px;color:${DANGER};white-space:nowrap">${r.poDays}d</td>
    <td align="right" valign="top" style="padding:9px 22px 9px 8px;border-top:1px solid ${HAIR};font-size:12.5px;font-weight:700;color:${INK};white-space:nowrap">${crL(r.value)}</td>
  </tr>`).join('')
  const awMore = aw?.more ? `<tr><td colspan="3" style="padding:8px 22px;border-top:1px solid ${HAIR};font-size:12px;color:${MUT}">+ ${aw.more} more</td></tr>` : ''
  const sectionB = aw ? `
    <tr><td style="padding:16px 22px 2px;border-top:1px solid ${HAIR}"><span style="font-size:15px;font-weight:600;color:${INK}">⏰ Chase delivery &amp; GRN</span><div style="font-size:11.5px;color:${MUT};margin-top:2px">PO placed <b style="color:${WARN}">1 week+ ago</b>, not received yet.</div></td></tr>
    <tr><td style="padding-top:6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${awRows}${awMore}</table></td></tr>` : ''

  const staleBanner = stale ? `<tr><td style="padding:12px 22px 0"><div style="font-size:12px;color:${WARN};background:${WARNBG};border-radius:9px;padding:9px 11px">⚠ No fresh upload since ${esc(fmtWhen(stale.lastUploadAt))} — numbers may be stale.</div></td></tr>` : ''

  const inner = `
    <tr><td style="padding:16px 22px 2px"><div style="font-size:16px;font-weight:700;color:${INK}">Good morning — your projects' follow-ups</div><div style="margin-top:8px">${projChips}</div></td></tr>
    ${staleBanner}${snap}${changesRow}${sectionA}${sectionB}
    <tr><td style="padding:18px 22px;border-top:1px solid ${HAIR}">${button('Open my projects', link)}</td></tr>`
  return shell(inner, `You're the Atm Head for these projects in CT HUB · reminders are combined into this one mail · manage alerts in Settings → Notifications`)
}

// ── Generic fallback (unchanged look, all other modules) ─────────────────
function renderGeneric(subject: string, text: string, link: string): string {
  const body = esc(text).replace(/\n/g, '<br/>')
  const inner = `
    <tr><td style="padding:16px 22px 4px"><div style="font-size:18px;font-weight:500;color:${INK}">${esc(subject)}</div></td></tr>
    <tr><td style="padding:4px 22px 8px;font-size:14px;line-height:1.6;color:#4b5563">${body}</td></tr>
    <tr><td style="padding:16px 22px">${button('Open CT HUB', link)}</td></tr>`
  return shell(inner)
}

export type NotificationKind = 'approval' | 'in4_pending' | 'in4_entered' | 'procurement_digest' | 'generic'

/** Map a notification `type` to a template kind. */
export function kindFromType(type: string | null | undefined): NotificationKind {
  switch (type) {
    case 'approval_pending':    return 'approval'
    case 'in4_pending':         return 'in4_pending'
    case 'in4_entered':         return 'in4_entered'
    case 'procurement_digest':  return 'procurement_digest'
    default:                    return 'generic'
  }
}

export function renderNotificationEmail(args: {
  kind: NotificationKind
  subject: string
  text: string
  link: string
  data?: Record<string, unknown> | null
}): string {
  const { kind, subject, text, link, data } = args
  try {
    if (kind === 'approval' && data) return renderApproval(data as ApprovalData, link)
    if (kind === 'in4_pending' && data) return renderIn4Pending(data as In4PendingData, link)
    if (kind === 'in4_entered' && data) return renderIn4Entered(data as In4EnteredData, link)
    if (kind === 'procurement_digest' && data) return renderProcurementDigest(data as ProcDigestData, link)
  } catch {
    // fall through to generic on any shape surprise
  }
  return renderGeneric(subject, text, link)
}
