// Send one Cost-Control budget-approval card — image + tappable Approve/Return
// buttons — to a single Telegram chat, and (best-effort) attach the working:
// the source Excel the engineer uploaded and the evidence image. The buttons
// carry ONLY the working-sheet id; the webhook re-resolves the tapper and runs
// the live approval engine (cc_tg_signoff / cc_tg_release). Nothing money-related
// is trusted from the client.
//
// callback_data grammar (kept < 64 bytes): "ccapv:<verb>:<wsId>"
//   sign   → PH/Atm sign-off  (webhook asks for the typed checked amount)
//   rel    → Trustee release   (webhook shows a Yes/Cancel confirm)
//   relok  → confirmed release
//   cancel → dismiss the confirm

import type { SupabaseClient } from '@supabase/supabase-js'
import { renderCardSpec } from './report-card'
import { buildApprovalCardSpec } from '@/lib/cost-control/approval-card'
import type { ApprovalCardData } from '@/lib/cost-control/approval-card-data'
import type { ApprovalStage } from '@/lib/cost-control/approval-card'
import { ccApprovalPath, type CcApprovalTarget } from '@/lib/cost-control/approval-link'
import { loadComputedWorkingRows, buildComputedWorkingPdf, loadApprovalTrail, loadCheckSummary } from '@/lib/cost-control/computed-working-pdf'
import { buildComputedWorkingImages } from '@/lib/cost-control/computed-working-image'

export const CB_PREFIX = 'ccapv'

const api = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`

// Build a Blob from bytes over a guaranteed ArrayBuffer (a fresh copy) — avoids
// the undici Buffer-backed-Blob quirk and satisfies the DOM BlobPart types.
function blobOf(bytes: Uint8Array, type: string): Blob {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return new Blob([ab], { type })
}

function appBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://ct-hub.vercel.app').replace(/\/$/, '')
}

type Btn = { text: string; callback_data?: string; url?: string }

/** The button strip for the stage the sheet is waiting at. PH/Atm sign-off vs
 *  Trustee release; Return/Partial always open the app (they need typed input).
 *  `test` = a dry-run card whose Approve button validates the plumbing but never
 *  mutates (verbs tsign/trel), so it can be sent safely to your own chat.
 *
 *  `project` adds the "full project" button beside it — the same project-first
 *  landing every other approval link now uses. The sheet button STAYS: it is the
 *  escape hatch for returning or part-approving, which can only be done there. */
export function approvalKeyboard(
  stage: ApprovalStage,
  wsId: string,
  test = false,
  project?: CcApprovalTarget,
): { inline_keyboard: Btn[][] } {
  const wsUrl = `${appBase()}/cost-control/working-sheets/${wsId}`
  const projBtn: Btn[] = project?.projectId
    ? [{ text: '🏢 Full project', url: `${appBase()}${ccApprovalPath({ ...project, wsId })}` }]
    : []
  const tag = test ? ' (test)' : ''
  if (stage === 'atm_approved' || stage === 'partially_approved') {
    return {
      inline_keyboard: [
        [{ text: `✅ Approve & release${tag}`, callback_data: `${CB_PREFIX}:${test ? 'trel' : 'rel'}:${wsId}` }],
        [{ text: '📊 Partial / Return — in app', url: wsUrl }, ...projBtn],
      ],
    }
  }
  // submitted (PH) / ph_approved (Atm)
  return {
    inline_keyboard: [
      [{ text: `✅ Approve${tag}`, callback_data: `${CB_PREFIX}:${test ? 'tsign' : 'sign'}:${wsId}` }],
      [{ text: '↩️ Return / open in app', url: wsUrl }, ...projBtn],
    ],
  }
}

/** After "Approve" (or "Approve & release") is tapped, the action button is
 *  swapped for this — so repeated taps can't fire another prompt. It only points
 *  back to the reply that's now waiting above, or cancels / opens the app. */
export function waitingKeyboard(wsId: string): { inline_keyboard: Btn[][] } {
  const wsUrl = `${appBase()}/cost-control/working-sheets/${wsId}`
  return {
    inline_keyboard: [
      [{ text: '⏳ Reply above to finish', callback_data: `${CB_PREFIX}:wait:${wsId}` }],
      [
        { text: '✖ Cancel', callback_data: `${CB_PREFIX}:scancel:${wsId}` },
        { text: '↩️ Open in app', url: wsUrl },
      ],
    ],
  }
}

/** The Yes/Cancel confirm keyboard shown after a Trustee taps "Approve & release". */
export function confirmReleaseKeyboard(wsId: string): { inline_keyboard: Btn[][] } {
  return {
    inline_keyboard: [
      [
        { text: '✅ Yes, release full', callback_data: `${CB_PREFIX}:relok:${wsId}` },
        { text: '✖ Cancel', callback_data: `${CB_PREFIX}:cancel:${wsId}` },
      ],
    ],
  }
}

async function tgSendPhoto(
  token: string, chatId: string, png: Buffer, caption: string, keyboard: object, filename: string,
): Promise<{ ok: boolean; error?: string }> {
  const bytes = new Uint8Array(png)
  // Try as a photo (inline preview); fall back to a document if rejected.
  try {
    const form = new FormData()
    form.append('chat_id', chatId)
    if (caption) form.append('caption', caption.slice(0, 1000))
    form.append('reply_markup', JSON.stringify(keyboard))
    form.append('photo', blobOf(bytes, 'image/png'), filename)
    const r = await fetch(api(token, 'sendPhoto'), { method: 'POST', body: form })
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string }
    if (j.ok) return { ok: true }

    const form2 = new FormData()
    form2.append('chat_id', chatId)
    if (caption) form2.append('caption', caption.slice(0, 1000))
    form2.append('reply_markup', JSON.stringify(keyboard))
    form2.append('document', blobOf(bytes, 'image/png'), filename)
    const r2 = await fetch(api(token, 'sendDocument'), { method: 'POST', body: form2 })
    const j2 = (await r2.json().catch(() => ({}))) as { ok?: boolean; description?: string }
    return j2.ok ? { ok: true } : { ok: false, error: j2.description || j.description || 'send failed' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'send-failed' }
  }
}

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')

// Last-resort text message carrying the same buttons — used if the image send
// fails, so the approver still gets an actionable message rather than nothing.
async function tgSendText(token: string, chatId: string, text: string, keyboard: object): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(api(token, 'sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true, reply_markup: keyboard }),
    })
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string }
    return j.ok ? { ok: true } : { ok: false, error: j.description || 'sendMessage failed' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'sendMessage-failed' }
  }
}

// Send a PNG as an inline photo (no buttons); fall back to a document if the
// image is too tall for Telegram's photo limits.
async function tgSendPhotoOnly(token: string, chatId: string, png: Buffer, caption: string): Promise<boolean> {
  const bytes = new Uint8Array(png)
  try {
    const form = new FormData()
    form.append('chat_id', chatId)
    if (caption) form.append('caption', caption.slice(0, 1000))
    form.append('photo', blobOf(bytes, 'image/png'), 'working.png')
    const r = await fetch(api(token, 'sendPhoto'), { method: 'POST', body: form })
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean }
    if (j.ok) return true
    const form2 = new FormData()
    form2.append('chat_id', chatId)
    if (caption) form2.append('caption', caption.slice(0, 1000))
    form2.append('document', blobOf(bytes, 'image/png'), 'working.png')
    const r2 = await fetch(api(token, 'sendDocument'), { method: 'POST', body: form2 })
    const j2 = (await r2.json().catch(() => ({}))) as { ok?: boolean }
    return !!j2.ok
  } catch { return false }
}

async function tgSendDocument(
  token: string, chatId: string, bytes: Uint8Array, filename: string, caption: string, mime: string,
): Promise<boolean> {
  try {
    const form = new FormData()
    form.append('chat_id', chatId)
    if (caption) form.append('caption', caption.slice(0, 1000))
    form.append('document', blobOf(bytes, mime), filename)
    const r = await fetch(api(token, 'sendDocument'), { method: 'POST', body: form })
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean }
    return !!j.ok
  } catch { return false }
}

/**
 * Render + send the approval card with its buttons to one chat, then attach the
 * working files. Best-effort on attachments (a missing file never blocks the
 * card). `dryRun` only tweaks the subtitle — the buttons still act on the real
 * sheet AS THE TAPPER, so a dry-run tap that isn't your stage is safely refused.
 */
export async function sendApprovalToChat(
  svc: SupabaseClient,
  token: string,
  chatId: string,
  data: ApprovalCardData,
  opts: { attach?: boolean; dryRun?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  const caption = opts.dryRun ? `Budget approval (TEST) · ${data.wsCode}` : `Budget approval · ${data.wsCode}`
  const keyboard = approvalKeyboard(data.status, data.wsId, opts.dryRun === true, {
    projectId: data.projectId, disciplineId: data.disciplineId, subSkillId: data.subSkillId,
  })

  // The text fallback (used if the image fails to render or send) — same
  // numbers, same buttons, so the approver can always act.
  const p = data.input
  const fallbackText = [
    `${caption}`,
    `${p.project.code}${p.project.name && p.project.name !== p.project.code ? ' · ' + p.project.name : ''} · ${p.work}`,
    `Amount ${inr(data.amount)} · waiting ${p.daysWaiting}d`,
    `Waiting on: ${p.nextActionLabel}${p.raisedBy ? ` · raised by ${p.raisedBy}` : ''}`,
  ].join('\n')

  let res: { ok: boolean; error?: string }
  try {
    const spec = buildApprovalCardSpec(data.input)
    if (opts.dryRun) spec.subtitle = `DRY RUN (test to your own chat) · ${spec.subtitle ?? ''}`.slice(0, 120)
    const png = await renderCardSpec(spec)
    res = await tgSendPhoto(token, chatId, png, caption, keyboard, `${data.wsCode}.png`)
  } catch (e) {
    res = { ok: false, error: e instanceof Error ? e.message : 'render-failed' }
  }
  // If the image path failed for any reason, send the text card so something
  // actionable always lands.
  if (!res.ok) {
    const t = await tgSendText(token, chatId, fallbackText, keyboard)
    if (!t.ok) return { ok: false, error: res.error || t.error }
    return { ok: true }
  }

  if (opts.attach !== false) {
    // Computed working (the parsed BOQ the app computed) — sent as inline
    // image(s) (glance) AND a PDF (record), both carrying the Excel-check
    // scorecard + take-off + the approval trail. Best-effort.
    try {
      const rows = await loadComputedWorkingRows(svc, data.wsId)
      if (rows.length) {
        const [trail, check] = await Promise.all([loadApprovalTrail(svc, data.wsId), loadCheckSummary(svc, data.wsId)])
        const imgs = buildComputedWorkingImages(data.input, data.wsCode, rows, trail, check)
        for (let i = 0; i < imgs.length; i++) {
          const cap = imgs.length > 1 ? `Computed working · ${data.wsCode} (${i + 1}/${imgs.length})` : `Computed working · ${data.wsCode}`
          await tgSendPhotoOnly(token, chatId, imgs[i], cap)
        }
        const pdf = buildComputedWorkingPdf(data.input, data.wsCode, rows, trail, check)
        await tgSendDocument(token, chatId, new Uint8Array(pdf), `${data.wsCode}-computed-working.pdf`, `Computed working · ${data.wsCode}`, 'application/pdf')
      }
    } catch { /* best-effort — the card still carries the numbers */ }

    // Fetch the working files from the cc-sheets bucket and forward them so the
    // approver has the full working in hand, not just the summary card.
    const { data: files } = await svc
      .from('cc_working_sheets')
      .select('source_excel_url, source_excel_name, summary_image_url, summary_image_name')
      .eq('id', data.wsId)
      .maybeSingle()
    const jobs: Array<{ path: string; name: string; mime: string }> = []
    if (files?.source_excel_url) {
      jobs.push({
        path: files.source_excel_url as string,
        name: (files.source_excel_name as string) || `${data.wsCode}.xlsx`,
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
    }
    if (files?.summary_image_url) {
      jobs.push({
        path: files.summary_image_url as string,
        name: (files.summary_image_name as string) || `${data.wsCode}-evidence.png`,
        mime: 'image/png',
      })
    }
    for (const j of jobs) {
      try {
        const { data: blob } = await svc.storage.from('cc-sheets').download(j.path)
        if (blob) {
          const buf = new Uint8Array(await blob.arrayBuffer())
          await tgSendDocument(token, chatId, buf, j.name, `Working · ${data.wsCode}`, j.mime)
        }
      } catch { /* best-effort — the card already carries the numbers */ }
    }
  }

  return { ok: true }
}
