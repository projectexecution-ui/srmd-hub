// Reconstruct how long a bill sat at each desk, from the audit events.
// Each event is a transition at created_at; the time in a stage = from when the
// bill entered it (the event whose to_stage=it) until the next event.
import { slaFor, type BbStage } from './stages'

export interface RawEvent {
  from_stage: BbStage | null
  to_stage: BbStage | null
  created_at: string
  actor: string | null
}

export interface TimelineSeg {
  stage: BbStage
  enteredAt: string
  days: number          // days held (or held-so-far if current)
  movedBy: string | null // who moved it OUT (null while current)
  current: boolean
  sla?: number
  breached: boolean
}

export function buildTimeline(eventsAsc: RawEvent[], currentStage: BbStage, nowMs: number): TimelineSeg[] {
  const segs: TimelineSeg[] = []
  let enteredAt: string | null = null
  let stage: BbStage | null = null

  const push = (leftMs: number, movedBy: string | null, current: boolean) => {
    if (!stage || !enteredAt) return
    const days = Math.max(0, (leftMs - new Date(enteredAt).getTime()) / 86_400_000)
    const sla = slaFor(stage)
    segs.push({ stage, enteredAt, days: Math.round(days * 10) / 10, movedBy, current, sla, breached: sla != null && days > sla })
  }

  for (const e of eventsAsc) {
    if (e.to_stage == null) continue
    if (stage == null) {
      // first entry (submission)
      stage = e.to_stage; enteredAt = e.created_at
      continue
    }
    // this event leaves `stage` and enters e.to_stage
    push(new Date(e.created_at).getTime(), e.actor, false)
    stage = e.to_stage; enteredAt = e.created_at
  }
  // trailing (current) stage
  if (stage) push(nowMs, null, true)
  return segs
}
