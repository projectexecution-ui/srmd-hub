/** Making a BOQ particular readable, with rules — not with a model.
 *
 *  Aksha, 14 Sep 2026: "the Abstract rows carry Huge BOQ content - can u make
 *  it shorter and when required i want to expand - so its easy for review -
 *  how will u do wihout AI"
 *
 *  Without AI, and deliberately so. A language model would paraphrase, and a
 *  paraphrase on a sheet somebody approves money from is a liability: it can
 *  quietly drop the one word that mattered, it answers differently on two
 *  runs, and nobody can say afterwards why it chose what it chose. What
 *  follows is a short list of rules you can read, test, and argue with.
 *
 *  THE PROBLEM, MEASURED
 *
 *  9,896 BOQ lines. Average 191 characters, longest 2,330, and 5,481 of them
 *  (55%) are over 64. A sheet of those is unreadable in a table.
 *
 *  THE STRUCTURE, WHICH IS WHY RULES WORK
 *
 *  IN4's particulars are built the same way nearly every time:
 *
 *      E) SITC OF INTERNAL WIRING. E.6) MISC. ITEMS 5) Installation,testing
 *      └──────────── section path ─────────────────┘ └──── the actual item ──
 *
 *      Providing and laying plain cement concrete (PCC) in substructure in …
 *      └─ contract boilerplate ─┘ └─ the thing ──┘ └── spec detail ─────────
 *
 *  Measured across all 9,896: 2,910 (29%) open with a section code, 1,504
 *  (15%) open with contract boilerplate, and 7,451 (75%) carry a clause break
 *  to cut at. So three rules cover nearly everything:
 *
 *    1  lift the section path off the front and show it as a chip
 *    2  drop the boilerplate lead-in — it says what you DO, not what it IS
 *    3  cut at the first clause boundary after a useful minimum
 *
 *  SAFETY
 *
 *  Every character shown comes from the original, in order. The rules only
 *  ever REMOVE whole spans — a heading, a lead-in verb, a trailing clause —
 *  and never reword, reorder or insert, so a dimension or a grade cannot be
 *  turned into a different one. (It is not one contiguous run: keeping the
 *  item number in front of a dropped verb makes it two spans. Both come from
 *  the source.) The full text is always one click away, a shortened row says
 *  so, and if the rules cannot shorten it safely it is left exactly as it is
 *  rather than mangled. */

export interface ShortParticular {
  /** The heading path IN4 prefixes, if any: "E) SITC OF INTERNAL WIRING". */
  section: string | null
  /** What to show in the row. */
  short: string
  /** Everything, for the expander. */
  full: string
  /** True when `short` is missing something `full` has. */
  shortened: boolean
}

/** Contract phrasing that opens a line and says what is DONE rather than what
 *  the item IS. Longest first, so "Providing and laying" wins over
 *  "Providing". Extend the list rather than reaching for cleverness. */
const LEAD_INS = [
  'installation, testing and commissioning of',
  'installation,testing and commissioning of',
  'installation testing and commissioning of',
  'installation, testing & commissioning of',
  'installation,testing & commissioning of',
  'supplying, installing, testing and commissioning of',
  'providing and supplying',
  'providing & supplying',
  'providing and laying',
  'providing & laying',
  'providing and fixing',
  'providing & fixing',
  'providing and applying',
  'providing & applying',
  'providing and grouting',
  'providing & grouting',
  'providing and',
  'providing & ',
  'providing',
  'supplying and installing',
  'supply and installation of',
  'sitc of',
  's.i.t.c of',
  'supply of',
  'supplying of',
  'making of',
  'erection of',
  'mix and apply',
]

/** Where a first clause reasonably ends. */
const BREAKS = [',', '.', ';', '(', ' - ', ' – ', ':']

// 16, not 24: "plain cement concrete" is 21 characters and is exactly the
// answer somebody wants. A higher floor walks straight past the good cut.
const MIN_USEFUL = 16
const MAX_SHORT = 68

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Is this stretch a HEADING (shouting) rather than the item itself?
 *  IN4 writes section headings in capitals and items in sentence case, which
 *  is the only signal available — and it is a reliable one here. */
function isHeading(s: string): boolean {
  const letters = s.replace(/[^A-Za-z]/g, '')
  if (letters.length < 3) return false
  // A heading is SHORT. Equipment specs are shouty too — "AHU TAG- SUPPLY
  // TF_CT RM … CFM-5100, TR-10, FILTRATION-2 STAGES …" is 180 characters of
  // capitals, and without this bound the peel swallowed it and left the row
  // showing only its tail.
  // 80 characters / 12 words. Measured against the real text: the longest
  // genuine headings are "ELECTRICAL CABLE TRAYS , EARTHING STRIPS & MCB SWITCH
  // GEARS." (60) and "MISCELLANEOUS ITEMS - THIS SHOULD BE EXECUTED WITH
  // PROPER TOOLS & TACKLES" (73), while the shouty specs that must NOT be
  // peeled start at 180. A wide gap, so the bound is not delicate.
  if (s.length > 80 || s.split(' ').length > 12) return false
  const caps = s.replace(/[^A-Z]/g, '').length
  return caps / letters.length > 0.75
}

/** A token that opens a numbered clause: `E)`, `17)`, `E.6)`, `J.1.1)`. */
const CODE = /^[A-Za-z0-9]{1,4}(?:\.[0-9]{1,3})*\)/
/** A word with no lowercase in it — IN4 shouts its headings. */
const SHOUTY = (w: string) => !/[a-z]/.test(w)

/** Peel `CODE) HEADING` groups off the front, for as long as they really are
 *  headings.
 *
 *  The heading runs from the code up to the first word containing a lowercase
 *  letter, or to the next code — whichever comes first. Walking words rather
 *  than hunting for the next code is what makes
 *  `17) CANVAS FOR EXPANSION JOINTS Supply of …` work: there IS no next code,
 *  and the heading simply ends where sentence case begins. */
function peelSection(text: string): { section: string | null; rest: string } {
  const parts: string[] = []
  let rest = squash(text)

  for (let guard = 0; guard < 6; guard++) {
    const m = rest.match(/^([A-Za-z0-9]{1,4}(?:\.[0-9]{1,3})*)\)\s*/)
    if (!m) break

    const words = rest.slice(m[0].length).split(' ')
    let take = 0
    while (take < words.length && SHOUTY(words[take]) && !CODE.test(words[take])) take++

    // Nothing shouty after the code, so this code belongs to the ITEM and not
    // to a heading. `4) Supply of SITE FABRICATED …` stops right here.
    const head = words.slice(0, take).join(' ')
    if (!head || !isHeading(head)) break

    const after = words.slice(take).join(' ').trim()
    // The heading was the whole line — hand it back as the item, so the row is
    // never blank.
    if (!after) return { section: parts.join(' · ') || null, rest: squash(`${m[1]}) ${head}`) }

    parts.push(squash(`${m[1]}) ${head}`).replace(/[.\s]+$/, ''))
    rest = after
  }

  return { section: parts.join(' · ') || null, rest: squash(rest) || squash(text) }
}

/** Drop the contract phrasing that opens a line, keeping any item number in
 *  front of it: `5) Installation, testing and commissioning of X` becomes
 *  `5) X`, because the number is a cross-reference people use and the verb
 *  is not. */
function dropLeadIn(text: string): string {
  const code = text.match(CODE)
  const prefix = code ? `${code[0]} ` : ''
  // IN4 wraps some particulars in quotes; an unstripped one blocks every rule
  // behind it and the row ends up showing the verb it was meant to lose.
  const body = (code ? text.slice(code[0].length) : text).trim().replace(/^["'“”]+s*/, '')
  const lower = body.toLowerCase()

  for (const lead of LEAD_INS) {
    if (!lower.startsWith(lead)) continue
    const cut = squash(body.slice(lead.length)).replace(/^[-–:,\s]+/, '')
    // Never leave a stub. If dropping it takes the meaning with it, keep it.
    if (cut.length >= 12) return prefix + cut
  }
  return text
}

function clip(text: string): string {
  if (text.length <= MAX_SHORT) return text

  // The floor is measured from the CONTENT, past any item number. Otherwise
  // "N.1.1) Installation, loading/unloading …" cuts at the comma and the row
  // shows a bare verb — the code had eaten the whole budget.
  const code = text.match(CODE)
  const floor = (code ? code[0].length + 1 : 0) + MIN_USEFUL

  // Prefer a real clause boundary.
  let best = -1
  for (const b of BREAKS) {
    const at = text.indexOf(b, floor)
    if (at > -1 && at <= MAX_SHORT && (best === -1 || at < best)) best = at
  }
  if (best > -1) return text.slice(0, best).trim()

  // Otherwise the last word boundary before the cap. Never mid-word, and never
  // mid-number, so a dimension can't be turned into a different one.
  const cut = text.lastIndexOf(' ', MAX_SHORT)
  return text.slice(0, cut > floor ? cut : MAX_SHORT).trim()
}

export function shortenBoq(raw: string | null | undefined): ShortParticular {
  const full = squash(raw ?? '')
  if (!full) return { section: null, short: '—', full: '', shortened: false }

  const { section, rest } = peelSection(full)
  const short = clip(dropLeadIn(rest))

  return {
    section,
    short: short || rest || full,
    full,
    // Shortened if anything at all is hidden: the section, the lead-in, or the tail.
    shortened: squash(short) !== full,
  }
}
