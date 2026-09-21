// Generic item sub-type — a keyword classifier that turns a raw IN4 material
// name into a broad, human "type" WITHOUT ever exposing the exact part name.
// The IN4 Indent→Issue report only carries a Work Category (the "discipline",
// e.g. "Plumbing Works") and the exact material — nothing in between — so this
// derives the missing middle layer so two "Plumbing Works" indents can be told
// apart (Pipes & fittings vs Drainage & chambers vs Valves …).
//
// Best-effort by design: source names are messy and typo-ridden. When no rule
// matches we return null and the caller falls back to the plain trade — we
// never guess a label that could mislead.

const TRADE_ALIAS: Record<string, string> = {
  'MGPS': 'Med-gas',
  'Infra Structures/Buildings': 'Infra buildings',
}

/** Trade label from the raw discipline: strip the leading code + trailing
 *  "Works"/"Cost", so "08 Plumbing Works" → "Plumbing", "23 Equipment Cost" →
 *  "Equipment", "12 Finishes" → "Finishes". */
export function tradeOf(discipline: string): string {
  const cleaned = (discipline || '')
    .replace(/^\s*\d+\s*/, '')
    .replace(/\s+(works|cost)\s*$/i, '')
    .trim() || 'General'
  return TRADE_ALIAS[cleaned] ?? cleaned
}

// Ordered specific → general. First match wins per material.
const RULES: Array<[RegExp, string]> = [
  // ── Plumbing / sanitary ────────────────────────────────────────────────
  [/wash\s*basin|water\s*closet|\bw\.?c\.?\b|urinal|cistern|health\s*faucet|\bfaucet\b|bib\s*cock|angle\s*cock|jet\s*spray|shower|soap\s*disp|towel\s*(rail|ring)|\bcp\b|chrome\s*plat/i, 'Sanitaryware & CP'],
  [/chamber|gull?ey|\btrap\b|manhole|nahani|floor\s*drain|vent\s*cowel|\bzali\b/i, 'Drainage & chambers'],
  [/\bvalve\b|\bnrv\b|\bprv\b|butterfly|gate\s*valve|ball\s*valve|check\s*valve|zoloto|foot\s*valve|sluice/i, 'Valves'],
  [/\bpump\b|submersible|booster|motor\s*pump/i, 'Pumps'],
  // ── Med-gas piping (MGPS) ─────────────────────────────────────────────
  [/medical\s*gas|\bmgps\b|oxygen\s*(pipe|outlet)|copper\s+(reduc\w+\s+)?(elbow|tee|coupler|bend|pipe|union|reducer)/i, 'Copper piping'],
  // ── Electrical ────────────────────────────────────────────────────────
  [/\bmcb\b|\brccb\b|\bmccb\b|\brcbo\b|\bacb\b|isolator|changeover|contactor|distribution\s*board/i, 'Switchgear & protection'],
  [/cable\s*tray|raceway|trunking/i, 'Cable trays'],
  [/\bwire\b|\bcable\b|\bconductor\b|sq\.?\s*mm|copper\s*flexible|armoured|\bflexible\b.*(cord|wire)/i, 'Wiring & cables'],
  [/conduit|junction\s*box|gang\s*box|back\s*box/i, 'Conduits & boxes'],
  [/\bl\.?e\.?d\.?\b|luminaire|down\s*light|flood\s*light|street\s*light|\blamp\b|batten|\blight\b/i, 'Lighting'],
  [/\bswitch\b|\bsocket\b|modular\s*plate|dimmer|regulator|cover\s*plate/i, 'Switches & sockets'],
  [/earth(ing)?|lightning\s*arrest|\bgi\s*strip/i, 'Earthing & lightning'],
  // ── Fire fighting ─────────────────────────────────────────────────────
  [/extingu|\bhydrant\b|sprinkler|hose\s*reel|smoke\s*detect|fire\s*(alarm|pump|door|hose)/i, 'Fire safety'],
  // ── Finishes ──────────────────────────────────────────────────────────
  [/\btile\b|\btiles\b|ceramic|vitrified|\bgvt\b|\bpgvt\b/i, 'Tiles'],
  [/granite|marble|\bstone\b|kota|kadappa|sandstone/i, 'Stone & granite'],
  [/\bpaint\b|primer|\bputty\b|emulsion|enamel|distemper|texture\s*coat|\bpop\b/i, 'Paint & putty'],
  [/epoxy|\bvinyl\b|laminate.*floor|wooden\s*floor|\bflooring\b/i, 'Flooring'],
  [/plaster|screed|\bgrout\b|tile\s*adhesive/i, 'Plaster & adhesives'],
  // ── Doors / windows / hardware ────────────────────────────────────────
  [/hinge|tower\s*bolt|door\s*(buffer|closer)|pull\s*handle|aldrop|\blatch\b|\bkich\b/i, 'Door hardware'],
  [/\bdoor\b|shutter|\bwindow\b|glazing|vision\s*panel/i, 'Doors & shutters'],
  // ── Furniture / appliances / equipment ────────────────────────────────
  [/\btable\b|\bchair\b|\bdesk\b|\bbed\b|\bsofa\b|cabinet|cupboard|wardrobe|\bstool\b|\bbench\b|furniture|\bshelf\b|\bshelv|\blocker\b/i, 'Furniture'],
  [/air\s*condition|\bahu\b|\bhvac\b|refrigerat|water\s*cooler|geyser|water\s*heater|\bups\b|\bd\.?g\.?\s*set|generator|exhaust\s*fan/i, 'Appliances & HVAC'],
  [/scrubber|sweeper|multiclean|side\s*brush|floor\s*clean|\bpallet\b|forklift|\bbopt\b/i, 'Cleaning & handling'],
  // ── Civil / structure / envelope ──────────────────────────────────────
  [/pre\s*engineered|\bpeb\b/i, 'Steel building'],
  [/paver|kerb/i, 'Paving blocks'],
  [/\btmt\b|rebar|reinforc|binding\s*wire|\bism[cb]\b/i, 'Steel & rebar'],
  [/cement|\bsand\b|aggregate|\brmc\b|\bconcrete\b|fly\s*ash|\bbrick|aac\s*block/i, 'Cement & aggregates'],
  [/galvalume|roofing|decking\s*sheet|\bacp\b|cladding|purlin/i, 'Roofing & cladding'],
  [/waterproof|mataseal|\bmembrane\b|bitumen/i, 'Waterproofing'],
  // ── ICT / network ─────────────────────────────────────────────────────
  [/cat\s*6|\brj\s*45|patch\s*(cord|panel)|\bcctv\b|\bnvr\b|fib(re|er)\b|network\s*switch/i, 'Network & CCTV'],
  // ── Landscape ─────────────────────────────────────────────────────────
  [/drip|inline\s*pipe|emitter|irrigation/i, 'Irrigation'],
  [/\bplant\b|sapling|manure|\bsoil\b|fertiliz|\bmulch\b/i, 'Plants & soil'],
  // ── Generic plumbing pipe / fittings (after the specific rules) ────────
  [/\bpipe\b/i, 'Pipes'],
  [/elbow|coupler|\btee\b|\bbend\b|bushing|\bbush\b|nipple|end\s*cap|reducer|\bunion\b|\bplug\b|\bpluk\b|\bshue\b|\bshoe\b|\bflange\b|\bgland\b|\bcpvc\b|\bupvc\b|\bpvc\b/i, 'Pipes & fittings'],
  // ── Fasteners (very generic — last) ───────────────────────────────────
  [/clamp|nut\s*-?\s*bolt|\bbolt\b|\bscrew\b|washer|anchor|fastener|\brawl/i, 'Clamps & fasteners'],
]

/** Classify one material name → a generic sub-type, or null if nothing fits. */
export function subTypeOf(material: string): string | null {
  const s = String(material || '')
  for (const [re, label] of RULES) if (re.test(s)) return label
  return null
}

/** The dominant (most common) sub-type across an indent's materials, or null. */
export function dominantSubType(materials: string[]): string | null {
  const counts = new Map<string, number>()
  for (const m of materials) {
    const t = subTypeOf(m)
    if (t) counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  let best: string | null = null
  let bestN = 0
  for (const [t, n] of counts) if (n > bestN) { best = t; bestN = n }
  return best
}

/** Display label for an indent: "Plumbing · Drainage & chambers", or just the
 *  trade when no sub-type could be derived. */
export function categoryLabel(discipline: string, materials: string[]): string {
  const trade = tradeOf(discipline)
  const sub = dominantSubType(materials)
  return sub ? `${trade} · ${sub}` : trade
}
