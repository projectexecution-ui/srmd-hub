// Email Command Centre — AI triage engine.
//
// Reuses the repo's free-tier AI helper (lib/ai: Gemini → Groq → Cerebras).
// Ports the SRMD-specific rules from the gmail-command-center skill: the six
// buckets, the construction shorthand decoder, the named counterparties, and
// the "escalate when unsure" rule.
//
// If no AI provider is configured (or the call fails), we fall back to a
// deterministic keyword heuristic so the module still produces a sensible
// triage — never a blank screen.

import { generateJSON, hasAiProvider } from '@/lib/ai'

export type EccCategory =
  | 'do_today'      // costs money or blocks work if it waits
  | 'this_week'     // decisions, design risk, people/HR
  | 'monitor'       // ball is with someone else — chase later
  | 'draft_pending' // a reply is half-written / owed
  | 'just_know'     // FYI, no action
  | 'delete'        // zero value / spam

export const ECC_CATEGORIES: EccCategory[] = [
  'do_today', 'this_week', 'monitor', 'draft_pending', 'just_know', 'delete',
]

export const ECC_CATEGORY_LABELS: Record<EccCategory, string> = {
  do_today: 'Do today',
  this_week: 'This week',
  monitor: 'Monitor',
  draft_pending: 'Draft pending',
  just_know: 'Just know',
  delete: 'Delete',
}

export interface RawEmail {
  thread_id: string
  message_id?: string | null
  subject: string
  sender: string
  snippet: string
  received_at: string   // ISO timestamp of the last message
  age_days: number      // today − received_at, in days
  is_from_me?: boolean  // last message was sent by the account owner
  has_draft?: boolean   // an unsent Gmail draft exists on this thread
}

export interface TriagedEmail extends RawEmail {
  category: EccCategory
  amount_inr: number | null
  tags: string[]
  suggested_action: string | null
  chase_on: string | null   // ISO date (yyyy-mm-dd) for monitor chase-ups
  summary: string | null    // one-line "what they want" (Auto-Summarize)
  smart_replies: string[]   // 2-3 short reply intents (Instant Reply chips)
}

// ── SRMD domain knowledge, ported from the skill ────────────────────────────
const SYSTEM_PROMPT = `You are the triage engine for a construction Project Manager at SRMD (Shrimad Rajchandra Mission), Dharampur. You sort inbox emails into a prioritised command centre. The user's point of view is SPEND: they pay contractors and vendors, they do not earn.

Sort every email into exactly ONE bucket:
- "do_today": costs money or blocks site work if it waits. Invoices/bills awaiting the PM's certification or payment, overdue vendor payments, expense-report/work-order approvals, passed deadlines, a direct ask from a senior (Kamal Mehta, Chirag Shah, Maulikji, Anooj Pal, Amit Gala, Project Head), GFC drawings blocking construction, a no-reply 7+ days old that blocks work.
- "this_week": decisions, design risks, people/HR (resignations, leave, interviews), ERP coordination (Odoo/Zoho/IN4), things that matter but are not same-day.
- "monitor": the ball is with someone else — the last message was sent by the PM's side and they're awaiting a reply/approval/return (e.g. work orders sent out for signature, a payment someone promised to process). Set chase_on to a near-future weekday.
- "draft_pending": a reply is owed and half-written — only if has_draft is true.
- "just_know": FYI, no action — MOMs, DPR/WPR/MPR reports, "approved" confirmations, automated status updates.
- "delete": zero value — newsletters, SaaS onboarding, spam, phishing, automated no-reply confirmations.

Shorthand you must understand: NGH = Nana Ghela Hospital; PMC = Project Management Consultant; ER = Expense Report; WO = Work Order; GFC = Good For Construction; BOQ = Bill of Quantities; DPR/WPR/MPR = Daily/Weekly/Monthly Progress Report; RA bill = Running Account bill; SRASSK / SRET / SRJT = SRMD trust entities.

Rules:
- If unsure between two buckets, ESCALATE to the more urgent one.
- amount_inr: extract the rupee figure at stake if clearly present (a plain number, e.g. 223820), else null. Never guess.
- tags: 1–3 short kebab tags like ["bill","srassk"] or ["hr"] or ["design","p2"].
- suggested_action: one short imperative line (e.g. "Certify the RA bill and reply to Desai"), or null for just_know/delete.
- chase_on: yyyy-mm-dd for monitor items only, else null.
- summary: ONE plain-English line saying what the sender actually wants / what this is (e.g. "Desai wants you to certify the ROAD-02 bill"). Always fill it.
- smart_replies: 2-3 SHORT reply-intent chips a busy PM would tap (e.g. ["Certify & acknowledge","Ask for measurement sheet","Flag a discrepancy"]). Empty array [] for just_know / delete / pure FYI.

Return STRICT JSON: {"items":[{"thread_id":"...","category":"...","amount_inr":null,"tags":[],"suggested_action":null,"chase_on":null,"summary":"...","smart_replies":[]}]}. One object per input email, same thread_id.`

interface AiTriageRow {
  thread_id: string
  category: EccCategory
  amount_inr: number | null
  tags: string[] | null
  suggested_action: string | null
  chase_on: string | null
  summary: string | null
  smart_replies: string[] | null
}

/**
 * Triage a batch of raw emails into command-centre items.
 * Uses the AI helper when available; otherwise a keyword heuristic.
 */
export async function triageEmails(emails: RawEmail[]): Promise<TriagedEmail[]> {
  if (emails.length === 0) return []

  if (hasAiProvider()) {
    const user = JSON.stringify(
      emails.map(e => ({
        thread_id: e.thread_id,
        subject: e.subject,
        sender: e.sender,
        snippet: e.snippet.slice(0, 300),
        age_days: e.age_days,
        is_from_me: !!e.is_from_me,
        has_draft: !!e.has_draft,
      })),
    )
    const res = await generateJSON<{ items: AiTriageRow[] }>({
      system: SYSTEM_PROMPT,
      user: `Triage these ${emails.length} emails. Today is ${new Date().toISOString().slice(0, 10)}.\n\n${user}`,
      maxOutputTokens: 8000,
    })
    if (res.ok && res.data?.items?.length) {
      const byId = new Map(res.data.items.map(r => [r.thread_id, r]))
      return emails.map(e => {
        const r = byId.get(e.thread_id)
        if (!r) return heuristicOne(e)
        return {
          ...e,
          category: ECC_CATEGORIES.includes(r.category) ? r.category : 'just_know',
          amount_inr: typeof r.amount_inr === 'number' && Number.isFinite(r.amount_inr) ? r.amount_inr : null,
          tags: Array.isArray(r.tags) ? r.tags.slice(0, 3) : [],
          suggested_action: r.suggested_action || null,
          chase_on: r.chase_on || null,
          summary: r.summary || null,
          smart_replies: Array.isArray(r.smart_replies) ? r.smart_replies.slice(0, 3) : [],
        }
      })
    }
    // fall through to heuristic on AI failure
  }

  return emails.map(heuristicOne)
}

// ── Deterministic fallback — keyword heuristic ──────────────────────────────
const NAMED_SENIORS = ['maulik', 'chirag', 'kamal mehta', 'anooj', 'amit gala', 'projecthead', 'project head']
const MONEY_WORDS = ['invoice', 'bill', 'payment', 'proforma', 'ra bill', 'overdue', 'certif', 'work order', ' wo ', 'expense', 'advance']
const PEOPLE_WORDS = ['resignation', 'leave', 'interview', 'candidate', 'hiring']
const FYI_WORDS = ['approved', 'mom', 'minutes of meeting', 'dpr', 'wpr', 'mpr', 'gfc details filled', 'summary', 'notification', 'task marked']
const JUNK_WORDS = ['newsletter', 'unsubscribe', 'security alert', 'compromised', 'no-reply', 'noreply', 'onboarding']

function heuristicOne(e: RawEmail): TriagedEmail {
  const hay = `${e.subject} ${e.snippet} ${e.sender}`.toLowerCase()
  const amount = extractAmount(hay)
  let category: EccCategory = 'just_know'

  if (e.has_draft) category = 'draft_pending'
  else if (JUNK_WORDS.some(w => hay.includes(w))) category = 'delete'
  else if (NAMED_SENIORS.some(w => hay.includes(w)) || MONEY_WORDS.some(w => hay.includes(w)) || (amount && amount > 0)) category = 'do_today'
  else if (PEOPLE_WORDS.some(w => hay.includes(w))) category = 'this_week'
  else if (e.is_from_me) category = 'monitor'
  else if (FYI_WORDS.some(w => hay.includes(w))) category = 'just_know'
  else if (e.age_days >= 7) category = 'this_week'

  const actionable = category !== 'just_know' && category !== 'delete'
  return {
    ...e,
    category,
    amount_inr: amount,
    tags: heuristicTags(hay),
    suggested_action: actionable ? `Review "${e.subject.slice(0, 48)}"` : null,
    chase_on: null,
    summary: e.snippet ? e.snippet.slice(0, 140) : e.subject,
    smart_replies: actionable ? ['Acknowledge', 'Ask for details'] : [],
  }
}

function extractAmount(hay: string): number | null {
  // Grab the largest plain integer of 4+ digits (e.g. "223820", "2,23,820").
  const matches = hay.replace(/[,]/g, '').match(/\b\d{4,9}\b/g)
  if (!matches) return null
  const nums = matches.map(Number).filter(n => Number.isFinite(n) && n >= 1000)
  return nums.length ? Math.max(...nums) : null
}

function heuristicTags(hay: string): string[] {
  const tags: string[] = []
  if (hay.includes('bill') || hay.includes('invoice')) tags.push('bill')
  if (hay.includes('srassk')) tags.push('srassk')
  if (hay.includes('ngh')) tags.push('ngh')
  if (hay.includes('work order') || hay.includes(' wo ')) tags.push('wo')
  if (hay.includes('resignation') || hay.includes('leave') || hay.includes('interview')) tags.push('hr')
  return tags.slice(0, 3)
}
