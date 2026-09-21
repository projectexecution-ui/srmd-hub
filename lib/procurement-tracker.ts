// Backward-compat re-export. New code should import from '@/lib/procurement'.
// Kept so any place that still does `import { ... } from '@/lib/procurement-tracker'`
// continues to work after the split.
export * from './procurement'
