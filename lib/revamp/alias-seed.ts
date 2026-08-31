// Seed aliases: IN4's name for a project → the hub's name for the same project.
//
// WHY THIS EXISTS. Stripping the stage suffix gets automatic matching from 7 to
// 18 of 102 sub-projects. The rest fail because IN4 and the hub simply spell
// the same building differently, and no amount of clever string matching can
// safely bridge that. Only a person knows that "Vinay ST" IS VINAY while
// "RU Infra" is NOT part of Raj Uphaar — both were settled by asking Aksha, and
// a matcher that guessed would have got one of them wrong. He asked for the map
// to be built in "for ease of job", so these are stated explicitly, one line
// each, with the reason.
//
// RULES FOR THIS FILE
//  1. Every entry needs a reason a person can check. No entry exists because
//     the strings looked similar.
//  2. `confidence` is honest. 'certain' = the abbreviation is used throughout
//     the hub. 'likely' = it reads right but nobody has confirmed it, and the
//     review screen shows it separately so Aksha can reject it.
//  3. A project the hub does NOT HAVE is never aliased onto a near neighbour.
//     Those stay unmatched on purpose — that is the ₹118 Cr of real spend
//     belonging to projects CT Hub has never been given.
//
// This is a seed, not the answer. The permanent version is a screen where
// Aksha confirms each one; these are the rows it would start from.

export type AliasConfidence = 'certain' | 'likely'

export interface ProjectAlias {
  /** The base name as IN4 writes it, after the stage suffix is stripped. */
  in4: string
  /** The hub project's name or code. */
  hub: string
  confidence: AliasConfidence
  why: string
}

export const PROJECT_ALIASES: ProjectAlias[] = [
  // NGH is the hub's abbreviation for New Guest House everywhere — the BPH
  // mapping already links "NGH A" to this project by a confirmed human choice.
  { in4: 'New Guest House A', hub: 'NGH A', confidence: 'certain', why: 'NGH is the hub’s abbreviation for New Guest House' },
  { in4: 'New Guest House B', hub: 'NGH B', confidence: 'certain', why: 'NGH is the hub’s abbreviation for New Guest House' },
  { in4: 'New Guest House C', hub: 'NGH C', confidence: 'certain', why: 'NGH is the hub’s abbreviation for New Guest House' },
  { in4: 'New Guest House - Infra Work', hub: 'NGH Infra', confidence: 'certain', why: 'Same building, same stage — “Infra Work” is the hub’s “Infra”' },

  // GROUP NAMES. IN4 writes the group, the hub splits it into children.
  // "New Guest House" in an upload is NGH-the-group, which holds NGH A/B/C,
  // NGH Infra and Common Expenses — so it belongs on the group, and the group's
  // cockpit rolls its children up. Confirmed by Aksha, 2026-08-31.
  { in4: 'New Guest House', hub: 'NGH', confidence: 'certain', why: 'The group holding NGH A, B, C, Infra and Common Expenses' },
  { in4: 'Vinay Vivek', hub: 'VV', confidence: 'certain', why: 'The group holding VINAY, VIVEK, VV Infra and Common Expenses' },
  { in4: 'P2 Stepped Terraces', hub: 'P2', confidence: 'certain', why: 'The group holding P2 Infra and the A01–A03 towers' },
  { in4: 'P2 Infra', hub: 'P2  Infra', confidence: 'certain', why: 'The hub name carries a double space' },

  // BILLS PIPELINE "area" values. The daily bills report names the building in
  // its own shorthand, which differs again from both IN4 and the hub.
  { in4: 'NGH Common Expenses', hub: 'New Guest House - Common Expenses', confidence: 'certain', why: 'The bills report abbreviates New Guest House to NGH' },
  { in4: 'VINAY Building', hub: 'VINAY', confidence: 'certain', why: 'The bills report appends “Building”' },
  { in4: 'VIVEK Building', hub: 'VIVEK', confidence: 'certain', why: 'The bills report appends “Building”' },
  { in4: 'VV Common Expenses', hub: 'Vinay Vivek Common Expenses', confidence: 'certain', why: 'The bills report abbreviates Vinay Vivek to VV' },
  { in4: 'P2 A02 Building', hub: 'P2 A02', confidence: 'certain', why: 'The bills report appends “Building”' },
  { in4: 'P2 A03 Building', hub: 'P2 A03', confidence: 'certain', why: 'The bills report appends “Building”' },

  // Plain plural.
  { in4: 'Ekant Kutirs', hub: 'Ekant Kutir', confidence: 'certain', why: 'Plural in IN4, singular in the hub' },

  // IN4 adds a word the hub does not.
  { in4: 'Admin Block 1st Floor Work', hub: 'Admin Block 1st Floor', confidence: 'certain', why: 'IN4 adds the word “Work”' },

  // The stage carries the building: "Execution A-01" IS the A01 tower.
  { in4: 'P2 Stepped Terraces - Execution A-01', hub: 'P2 A01', confidence: 'certain', why: 'A-01 is the A01 tower; the hub splits the towers into their own projects' },
  { in4: 'P2 Stepped Terraces - Execution A-02', hub: 'P2 A02', confidence: 'certain', why: 'A-02 is the A02 tower' },
  { in4: 'P2 Stepped Terraces - Execution A-03', hub: 'P2 A03', confidence: 'certain', why: 'A-03 is the A03 tower' },

  // The Indent → PO tracker names this one in full.
  { in4: 'SR Animal Hospital', hub: 'SRAH', confidence: 'certain', why: 'SRAH is Shrimad Rajchandra Animal Hospital' },

  // CONFIRMED by Aksha 2026-08-31. Plain Infra IS the hub's VV Infra project —
  // unlike MEP Infra, which he confirmed is separate. The two are not the same
  // rule, which is why each was asked rather than inferred.
  { in4: 'Vinay Vivek Infra', hub: 'VV Infra', confidence: 'certain', why: 'Confirmed by Aksha — this is the VV Infra project' },

  // CONFIRMED by Aksha 2026-08-31. "ST" is not a different project — these are
  // the VINAY and VIVEK buildings, so their ₹2.78 Cr rolls up under VV.
  { in4: 'Vinay ST', hub: 'VINAY', confidence: 'certain', why: 'Confirmed by Aksha — the VINAY building' },
  { in4: 'Vivek ST', hub: 'VIVEK', confidence: 'certain', why: 'Confirmed by Aksha — the VIVEK building' },
]

/**
 * NOT aliased on purpose. Each of these is real money against a project the
 * hub has never been given — mapping them onto a near neighbour would move
 * spend onto the wrong building, which is worse than leaving it visible and
 * unattributed.
 */
export const DELIBERATELY_UNMAPPED: Array<{ in4: string; why: string }> = [
  // Aksha will create these himself (2026-08-31). Nothing to do here when he
  // does: name the project exactly "Raj Uphaar" / "Raj Saurabh" and every stage
  // under it attaches on the next page load, because the matcher strips the
  // stage and matches the base. Its Infra Work stays separate, as he confirmed.
  { in4: 'Raj Uphaar', why: 'Aksha is creating it — attaches automatically once a project named "Raj Uphaar" exists' },
  // CONFIRMED by Aksha 2026-08-31: RU Infra is a SEPARATE project, not part of
  // Raj Uphaar. Do not fold its ₹10.94 Cr into Raj Uphaar.
  { in4: 'RU', why: 'RU Infra is its own project, separate from Raj Uphaar (Aksha confirmed, 2026-08-31). Not in CT Hub yet' },
  { in4: 'Raj Saurabh', why: 'Aksha is creating it — attaches automatically once a project named "Raj Saurabh" exists' },
  { in4: 'Common Facility Block', why: "Parked by Aksha's decision, 2026-08-31 — attaches automatically if it is ever created" },
  { in4: 'Staff Facilities Block', why: "Parked by Aksha's decision, 2026-08-31 — attaches automatically if it is ever created" },
  { in4: 'Old Swadhyay Hall', why: 'No such project in CT Hub — one of the four to create' },
  { in4: 'Naturopathy', why: 'No such project in CT Hub — one of the four to create' },
  { in4: 'DN Extension', why: "Parked by Aksha's decision, 2026-08-31 — attaches automatically if it is ever created" },
  { in4: 'DN Annex Extension', why: "Parked by Aksha's decision, 2026-08-31 — attaches automatically if it is ever created" },
  { in4: 'DN Annex Refurbish', why: "Parked by Aksha's decision, 2026-08-31 — attaches automatically if it is ever created" },
  { in4: 'Prem Parking', why: 'No such project in CT Hub' },
  // CONFIRMED by Aksha 2026-08-31: AV House is its OWN project, NOT the hub's
  // "Admin Block AV House". My earlier guess was wrong and is removed.
  { in4: 'AV House', why: 'Its own project, not the hub’s Admin Block AV House (Aksha confirmed, 2026-08-31)' },
  // CONFIRMED by Aksha 2026-08-31: "p2 row house is a project - but infra is
  // seperate and common expense is also diff - but these all are of same group".
  // So three distinct projects under the P2 group; only Common Expenses exists
  // in CT Hub today (P2RHCE) and it matches by its own exact name.
  { in4: 'P2 Row Houses', why: 'A project in its own right, under the P2 group — not yet in CT Hub (Aksha confirmed, 2026-08-31)' },
  { in4: 'P2 Row Houses - Infra Work', why: 'Separate from P2 Row Houses itself (Aksha confirmed, 2026-08-31). Not in CT Hub' },
  { in4: 'Raj Uphaar - Infra Work', why: 'Infra is its own project, not a stage of Raj Uphaar' },
  { in4: 'Raj Sabhagruh Museum', why: "Parked by Aksha's decision, 2026-08-31 — attaches automatically if it is ever created" },
  // CONFIRMED by Aksha 2026-08-31: a DIFFERENT warehouse, not Civil & MEP
  // Central Warehouse (which appears separately in the same upload with only
  // ₹76,640). ₹15.73 Cr stays parked until the project is created.
  { in4: 'Warehouse', why: 'A different warehouse — CT Hub has no such project yet (Aksha confirmed, 2026-08-31). ₹15.73 Cr parked' },
  // CONFIRMED by Aksha 2026-08-31: MEP infrastructure is tracked as its OWN
  // project, not as the MEP scope of the building it is named after. So these
  // must never be folded into VV / Ekant Kutir / P2.
  { in4: 'Vinay Vivek MEP Infra', why: 'MEP Infra is a separate project, not part of VV (Aksha confirmed, 2026-08-31)' },
  { in4: 'Ekant Kutir MEP Infra', why: 'MEP Infra is a separate project, not part of Ekant Kutir (Aksha confirmed, 2026-08-31)' },
  { in4: 'Step Terrace MEP Infra', why: 'MEP Infra is a separate project, not part of P2 (Aksha confirmed, 2026-08-31)' },
  // CONFIRMED by Aksha 2026-08-31: both are real projects CT Hub does not have
  // yet, not overheads. Parked until created, then they attach on their own.
  { in4: 'Design Admin', why: 'A real project, not yet in CT Hub (Aksha confirmed, 2026-08-31)' },
  { in4: 'Professional Consultancy (Staff)', why: 'A real project, not yet in CT Hub (Aksha confirmed, 2026-08-31)' },
  { in4: 'MULTIPLE', why: 'IN4’s own catch-all — unattributable by design, ₹3.16 Cr' },
]
