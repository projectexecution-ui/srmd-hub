// Seed aliases: IN4's name for a project → the hub's name for the same project.
//
// WHY THIS EXISTS. Stripping the stage suffix gets automatic matching from 7 to
// 18 of 102 sub-projects. The rest fail because IN4 and the hub simply spell
// the same building differently, and no amount of clever string matching can
// safely bridge that — "Vinay ST" and "VINAY" look close and are probably NOT
// the same thing. Aksha asked for the map to be built in "for ease of job", so
// these are stated explicitly, one line each, with the reason.
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

  // AV House sits under Admin Block in the hub.
  { in4: 'AV House', hub: 'Admin Block AV House', confidence: 'likely', why: 'The hub files AV House under Admin Block; IN4 lists it on its own' },

  // Vinay Vivek Infra ↔ VV Infra. VV is the hub's code for Vinay Vivek.
  { in4: 'Vinay Vivek Infra', hub: 'VV Infra', confidence: 'likely', why: 'VV is the hub’s code for Vinay Vivek' },
]

/**
 * NOT aliased on purpose. Each of these is real money against a project the
 * hub has never been given — mapping them onto a near neighbour would move
 * spend onto the wrong building, which is worse than leaving it visible and
 * unattributed.
 */
export const DELIBERATELY_UNMAPPED: Array<{ in4: string; why: string }> = [
  { in4: 'Raj Uphaar', why: 'No such project in CT Hub' },
  { in4: 'Raj Saurabh', why: 'No such project in CT Hub' },
  { in4: 'Common Facility Block', why: 'No such project in CT Hub' },
  { in4: 'Staff Facilities Block', why: 'No such project in CT Hub' },
  { in4: 'Old Swadhyay Hall', why: 'No such project in CT Hub — one of the four to create' },
  { in4: 'Naturopathy', why: 'No such project in CT Hub — one of the four to create' },
  { in4: 'DN Extension', why: 'No such project in CT Hub' },
  { in4: 'DN Annex Extension', why: 'No such project in CT Hub' },
  { in4: 'DN Annex Refurbish', why: 'No such project in CT Hub' },
  { in4: 'Prem Parking', why: 'No such project in CT Hub' },
  { in4: 'Raj Sabhagruh Museum', why: 'No such project in CT Hub' },
  { in4: 'Warehouse', why: 'Ambiguous — may or may not be Civil & MEP Central Warehouse. Needs Aksha' },
  { in4: 'Vinay ST', why: 'Ambiguous — “ST” is probably Stepped Terrace, not VINAY. Needs Aksha' },
  { in4: 'Vivek ST', why: 'Ambiguous — same as Vinay ST. Needs Aksha' },
  { in4: 'MULTIPLE', why: 'IN4’s own catch-all — unattributable by design, ₹3.16 Cr' },
]
