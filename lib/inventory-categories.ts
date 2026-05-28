// Canonical inventory categories — covers the bulk of Indian construction
// site materials. Keep flat (no sub-categories) so the picker stays fast.
// The string values are what land in inv_items.category, so renaming any
// of these later requires a data migration.

export const INVENTORY_CATEGORIES = [
  'Cement & Concrete',
  'Steel & Reinforcement',
  'Masonry',
  'Aggregates & Sand',
  'Plumbing',
  'Electrical',
  'HVAC & Ventilation',
  'Doors & Windows',
  'Glass & Glazing',
  'Finishes — Paint',
  'Finishes — Tile & Flooring',
  'Finishes — Wood & Veneer',
  'Waterproofing',
  'Scaffolding & Formwork',
  'Hardware & Fasteners',
  'Tools',
  'Safety & PPE',
  'Cleaning & Consumables',
  'Miscellaneous',
] as const

export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number]

// Lucide icon name per category so the picker/list can show a glyph
// when an item has no image. Plain strings (not imports) so the file
// stays usable from both server and client without bundling all icons.
export const CATEGORY_ICON: Record<string, string> = {
  'Cement & Concrete':          'Layers',
  'Steel & Reinforcement':      'Wrench',
  'Masonry':                    'Brick',
  'Aggregates & Sand':          'Mountain',
  'Plumbing':                   'Droplets',
  'Electrical':                 'Zap',
  'HVAC & Ventilation':         'Fan',
  'Doors & Windows':            'DoorClosed',
  'Glass & Glazing':            'Square',
  'Finishes — Paint':           'PaintBucket',
  'Finishes — Tile & Flooring': 'Grid3x3',
  'Finishes — Wood & Veneer':   'TreePine',
  'Waterproofing':              'Umbrella',
  'Scaffolding & Formwork':     'Construction',
  'Hardware & Fasteners':       'Nut',
  'Tools':                      'Hammer',
  'Safety & PPE':               'HardHat',
  'Cleaning & Consumables':     'Sparkles',
  'Miscellaneous':              'Box',
}
