// Standard tower work-item template — mirrors the SRMD NGH Zoho WBS
// (11 disciplines → sub-system items). Floors are matrix columns, one row per
// sub-system. Each item carries the standard construction sequence written the
// plain way: follows = "starts after <that item>", gap = curing/handover days,
// cycle = days per floor. All editable per project; this is just the default.

export interface TemplateItem {
  name: string
  uom: string
  sub?: string
  cycle?: number              // days per floor
  follows?: [string, string]  // [trade, name] it starts after (same template)
  gap?: number                // + days gap after the predecessor
}
export interface TemplateTrade {
  trade: string
  items: TemplateItem[]
}

export const DEFAULT_TEMPLATE: TemplateTrade[] = [
  {
    trade: 'Civil',
    items: [
      { name: 'Slab', uom: 'Cum', cycle: 10 }, // the anchor — set its start date, the tower derives
      { name: 'Brick Work', uom: 'Cum', cycle: 7, follows: ['Civil', 'Slab'], gap: 10 },
      { name: 'Internal Plaster', uom: 'Sqm', cycle: 7, follows: ['Electrical', 'Point Wiring & Switch/Sockets'], gap: 0 },
      { name: 'Window Sill', uom: 'Rmt', cycle: 4, follows: ['Civil', 'Internal Plaster'], gap: 0 },
      { name: 'Expansion Joint', uom: 'Sqm', cycle: 3, follows: ['Civil', 'Slab'], gap: 15 },
      { name: 'External Plaster', uom: 'Sqm', cycle: 6, follows: ['Civil', 'Brick Work'], gap: 30 },
    ],
  },
  {
    trade: 'Waterproofing',
    items: [
      { name: 'Bath & Toilets', uom: 'Nos', cycle: 4, follows: ['Civil', 'Internal Plaster'], gap: 0 },
      { name: 'Balconies', uom: 'Nos', cycle: 3, follows: ['Civil', 'Internal Plaster'], gap: 0 },
      { name: 'Terraces', uom: 'Sqm', cycle: 5, follows: ['Civil', 'Slab'], gap: 20 },
      { name: 'Windows', uom: 'Nos', cycle: 3, follows: ['Civil', 'Window Sill'], gap: 0 },
      { name: 'OHT / UGT', uom: 'Nos', cycle: 5 },
      { name: 'Lift Pits', uom: 'Nos', cycle: 3 },
    ],
  },
  {
    trade: 'Plumbing & Drainage',
    items: [
      { name: 'External Chambers', uom: 'Nos', cycle: 5 },
      { name: 'Water Supply', uom: 'Rmt', cycle: 5, follows: ['Civil', 'Brick Work'], gap: 0 },
      { name: 'Sewage', uom: 'Rmt', cycle: 5, follows: ['Civil', 'Brick Work'], gap: 0 },
      { name: 'SW/CP Fittings', uom: 'Nos', cycle: 3, follows: ['Finishes', 'DADO'], gap: 0 },
    ],
  },
  {
    trade: 'Fire Fighting',
    items: [
      { name: 'Pump Room', uom: 'Nos', cycle: 10 },
      { name: 'Sprinklers', uom: 'Nos', cycle: 4, follows: ['Civil', 'Internal Plaster'], gap: 0 },
      { name: 'Hydrants', uom: 'Rmt', cycle: 4, follows: ['Civil', 'Brick Work'], gap: 5 },
      { name: 'FAPA', uom: 'Nos', cycle: 3, follows: ['Civil', 'Internal Plaster'], gap: 0 },
      { name: 'Fire Extinguishers', uom: 'Nos', cycle: 1, follows: ['Finishes', 'Internal painting'], gap: 0 },
    ],
  },
  {
    trade: 'Electrical',
    items: [
      { name: 'Earthing & Lightning Arrestor', uom: 'Nos', cycle: 5 },
      { name: 'Cabling', uom: 'Rmt', cycle: 5, follows: ['Civil', 'Brick Work'], gap: 0 },
      { name: 'Point Wiring & Switch/Sockets', uom: 'Rmt', cycle: 5, follows: ['Civil', 'Brick Work'], gap: 0 },
      { name: 'DBs', uom: 'Nos', cycle: 3, follows: ['Electrical', 'Point Wiring & Switch/Sockets'], gap: 5 },
      { name: 'Panels', uom: 'Nos', cycle: 5, follows: ['Electrical', 'DBs'], gap: 5 },
      { name: 'UPS', uom: 'Nos', cycle: 3, follows: ['Electrical', 'DBs'], gap: 5 },
      { name: 'Light Fitting', uom: 'Nos', cycle: 3, follows: ['Finishes', 'False Ceiling - Gypsum'], gap: 0 },
      { name: 'Appliances', uom: 'Nos', cycle: 2, follows: ['Electrical', 'Light Fitting'], gap: 0 },
    ],
  },
  {
    trade: 'Mechanical / HVAC',
    items: [
      { name: 'Lifts', uom: 'Nos', cycle: 15 },
      { name: 'HVAC ACs', uom: 'Nos', cycle: 4, follows: ['Civil', 'Internal Plaster'], gap: 0 },
      { name: 'HVAC VRV', uom: 'Nos', cycle: 5, follows: ['Civil', 'Internal Plaster'], gap: 0 },
      { name: 'MS Fabrication', uom: 'Nos', cycle: 5, follows: ['Civil', 'Brick Work'], gap: 10 },
      { name: 'Kitchen Exhaust', uom: 'Nos', cycle: 2, follows: ['Finishes', 'False Ceiling - Gypsum'], gap: 0 },
    ],
  },
  {
    trade: 'ICT',
    items: [
      { name: 'Internet Cabling', uom: 'Rmt', cycle: 4, follows: ['Civil', 'Brick Work'], gap: 0 },
      { name: 'Tel Cabling', uom: 'Rmt', cycle: 4, follows: ['Civil', 'Brick Work'], gap: 0 },
      { name: 'CCTV Cabling', uom: 'Rmt', cycle: 4, follows: ['Civil', 'Brick Work'], gap: 0 },
      { name: 'Door Access Control', uom: 'Nos', cycle: 2, follows: ['Finishes', 'Wooden Doors'], gap: 0 },
      { name: 'Device Fittings', uom: 'Nos', cycle: 3, follows: ['Finishes', 'Internal painting'], gap: 0 },
      { name: 'TVs / Projectors', uom: 'Nos', cycle: 2, follows: ['Interiors', 'Fixed Furniture'], gap: 0 },
    ],
  },
  {
    trade: 'External Facade',
    items: [
      { name: 'GRC Jali', uom: 'Sqm', cycle: 8, follows: ['Civil', 'External Plaster'], gap: 0 },
    ],
  },
  {
    trade: 'Finishes',
    items: [
      { name: 'DADO', uom: 'Sqm', cycle: 4, follows: ['Waterproofing', 'Bath & Toilets'], gap: 0 },
      { name: 'Flooring', uom: 'Sqm', cycle: 5, follows: ['Finishes', 'DADO'], gap: 0 },
      { name: 'Door Frame', uom: 'Nos', cycle: 3, follows: ['Civil', 'Brick Work'], gap: 0 },
      { name: 'Windows', uom: 'Nos', cycle: 3, follows: ['Civil', 'Window Sill'], gap: 0 },
      { name: 'Ceiling', uom: 'Sqm', cycle: 3, follows: ['Civil', 'Internal Plaster'], gap: 0 },
      { name: 'Internal Putty', uom: 'Sqm', cycle: 5, follows: ['Civil', 'Internal Plaster'], gap: 7 },
      { name: 'Wall Finishes', uom: 'Sqm', cycle: 4, follows: ['Finishes', 'Internal Putty'], gap: 0 },
      { name: 'False Ceiling - Gypsum', uom: 'Sqm', cycle: 5, follows: ['Fire Fighting', 'Sprinklers'], gap: 0 },
      { name: 'False Ceiling - Calcium Silicate', uom: 'Sqm', cycle: 4, follows: ['Fire Fighting', 'Sprinklers'], gap: 0 },
      { name: 'False Ceiling - 2x2', uom: 'Sqm', cycle: 3, follows: ['Fire Fighting', 'Sprinklers'], gap: 0 },
      { name: 'Internal painting', uom: 'Sqm', cycle: 5, follows: ['Finishes', 'False Ceiling - Gypsum'], gap: 0 },
      { name: 'Internal Partitions', uom: 'Sqm', cycle: 4, follows: ['Finishes', 'Flooring'], gap: 0 },
      { name: 'Kitchen & Toilet Platform', uom: 'Nos', cycle: 3, follows: ['Waterproofing', 'Bath & Toilets'], gap: 0 },
      { name: 'Wooden Doors', uom: 'Nos', cycle: 3, follows: ['Finishes', 'Door Frame'], gap: 20 },
      { name: 'Door Shutters', uom: 'Nos', cycle: 3, follows: ['Finishes', 'Internal painting'], gap: 0 },
      { name: 'Fire Doors', uom: 'Nos', cycle: 2, follows: ['Finishes', 'Door Frame'], gap: 20 },
      { name: 'Railings', uom: 'Rmt', cycle: 3, follows: ['Finishes', 'Flooring'], gap: 0 },
      { name: 'Mirrors', uom: 'Nos', cycle: 1, follows: ['Finishes', 'Internal painting'], gap: 0 },
      { name: 'White Goods', uom: 'Nos', cycle: 2, follows: ['Finishes', 'Internal painting'], gap: 0 },
      { name: 'External Paint', uom: 'Sqm', cycle: 6, follows: ['Civil', 'External Plaster'], gap: 10 },
    ],
  },
  {
    trade: 'Interiors',
    items: [
      { name: 'Fixed Furniture', uom: 'Nos', cycle: 5, follows: ['Finishes', 'Internal painting'], gap: 5 },
      { name: 'Loose Furniture', uom: 'Nos', cycle: 3, follows: ['Interiors', 'Fixed Furniture'], gap: 0 },
    ],
  },
  {
    trade: 'Cleaning',
    items: [
      { name: 'General Cleaning', uom: 'Nos', cycle: 2, follows: ['Interiors', 'Loose Furniture'], gap: 0 },
      { name: 'Deep Cleaning', uom: 'Nos', cycle: 2, follows: ['Cleaning', 'General Cleaning'], gap: 0 },
    ],
  },
]

export const TEMPLATE_ITEM_COUNT = DEFAULT_TEMPLATE.reduce((n, t) => n + t.items.length, 0)

/** Flat lookup of the template's default sequencing, keyed by trade|name. */
export function templateSequenceDefaults(): Map<string, { cycle: number | null; follows: [string, string] | null; gap: number }> {
  const m = new Map<string, { cycle: number | null; follows: [string, string] | null; gap: number }>()
  for (const t of DEFAULT_TEMPLATE) for (const it of t.items) {
    m.set(`${t.trade}|${it.name}`.toLowerCase(), { cycle: it.cycle ?? null, follows: it.follows ?? null, gap: it.gap ?? 0 })
  }
  return m
}
