import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The core sources use `.ts` extensions in relative imports (ESM style);
    // vitest resolves them natively (no extra resolver needed).
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'lcov'],
      // Coverage floors (3.12, 2026-09-20): the global floor guards the whole
      // core; per-directory floors lock in the strong modules so they never
      // regress below measured levels (margin ~2-5 pts under the 2026-09-20
      // run). Phase 6 (QC/CI) raises these as parser/platform tests land.
      thresholds: {
        statements: 55,
        branches: 50,
        functions: 60,
        lines: 58,
        ['src/store/**/*.ts']: { statements: 90, branches: 75, functions: 85, lines: 90 },
        ['src/tools/**/*.ts']: { statements: 85, branches: 70, functions: 90, lines: 85 },
        ['src/browser/**/*.ts']: { statements: 75, branches: 55, functions: 85, lines: 78 },
        ['src/fetch/**/*.ts']: { statements: 75, branches: 60, functions: 78, lines: 75 },
      },
    },
  },
})
