// Reconstruct how long a bill sat at each desk, from the audit events.
// Each event is a transition at created_at; the time in a stage = from when the
// bill entered it (the event whose to_stage=it) until the next event.
//
// Aksha, 16 Sep 2026, screen B of the look-and-feel preview: the timeline
// names the person and the days at each desk, and puts the send-back reason
// where it happened rather than in a separate log. So each segment now also
// carries HOW it was left — the action and the comment on the event that
// moved the bill on — which is all the flow card needs to read as a story.
import { slaFor, type BbStage } from './stages'

export interface RawEvent {
  from_stage: BbStage | null
  to_stage: BbStage | null
  created_at: string
  actor: string | null
  /** 'forward' | 'send_back' | 'hold' | 'resume' | 'reject' | 'undo' | … */
  action?: string | null
  comment?: string | null
}

export interface TimelineSeg {
  stage: BbStage
  enteredAt: string
  days: number          // days held (or held-so-far if current)
  movedBy: string | null // who moved it OUT (null while current)
  /** How it left this desk — 'forward', 'send_back', 'undo'… Null while current. */
  leftAction: string | null
  /** What they said when they moved it — the send-back reason, chiefly. */
  leftComment: string | null
  /** True when nobody moved it: IN4's approval did, or a bill raised itself. */
  automatic: boolean
  current: boolean
  sla?: number
  breached: boolean
}

export function buildTimeline(eventsAsc: RawEvent[], currentStage: BbStage, nowMs: number = Date.now()): TimelineSeg[] {
  const segs: TimelineSeg[] = []
  let enteredAt: string | null = null
  let stage: BbStage | null = null

  const push = (leftMs: number, left: RawEvent | null, current: boolean) => {
    if (!stage || !enteredAt) return
    const days = Math.max(0, (leftMs - new Date(enteredAt).getTime()) / 86_400_000)
    const sla = slaFor(stage)
    segs.push({
      stage, enteredAt,
      days: Math.round(days * 10) / 10,
      movedBy: left?.actor ?? null,
      leftAction: left?.action ?? null,
      leftComment: left?.comment ?? null,
      automatic: !!left && !left.actor,
      current, sla,
      breached: sla != null && days > sla,
    })
  }

  for (const e of eventsAsc) {
    if (e.to_stage == null) continue
    if (stage == null) {
      // first entry (submission)
      stage = e.to_stage; enteredAt = e.created_at
      continue
    }
    // this event leaves `stage` and enters e.to_stage
    push(new Date(e.created_at).getTime(), e, false)
    stage = e.to_stage; enteredAt = e.created_at
  }
  // trailing (current) stage
  if (stage) push(nowMs, null, true)
  return segs
}
