import { defineConfig } from 'vitest/config'

// Unit-test config. Node environment — these are pure-logic tests only
// (no DOM/React rendering), so they run fast and need no jsdom.
// resolve.tsconfigPaths makes the "@/..." import alias resolve the same
// way it does in the app (native Vite support, no extra plugin).
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    // .tmp-* holds ad-hoc scripts (some reach real databases) — never part of the suite.
    // out/ is gitignored scratch — the build worktrees each session makes
    // (with a node_modules junction inside) live there, and their vendored
    // tests must never count as ours.
    exclude: ['node_modules', '**/node_modules/**', '.next', 'dist', '.tmp-*/**', 'out/**'],
  },
})
