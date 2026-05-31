import { defineConfig } from 'vitest/config';

// Coverage governance (current floor — see docs/KNOWN_ISSUES.md KI-P14-002).
//
// Phase 17F closeout: the server suite (23 files / 383 tests at this branch)
// now exercises every Phase 17 rules-engine surface (marks aggregation,
// moderation/ratification, cohort generation, progression decisioning,
// award classification, transcript composition). This is the first ratchet
// from the previous 0/0/0/0 monitor-only policy.
//
// Thresholds were chosen by measuring the suite on this branch
// (Statements 38.39%, Branches 36.93%, Functions 18.76%, Lines 37.67%) and
// then sitting ~3 percentage points below each actual to leave headroom
// for honest churn. The job of the floor is to catch regression — it is
// not yet sized to drive new test creation; that is sequenced to Phase 18+.
//
// This config is the single source of truth: local `npm run test:coverage`
// and CI `vitest run --coverage` enforce identical thresholds. Future
// ratchets bump these numbers in this file alone.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      include: ['src/api/**/*.service.ts', 'src/repositories/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
      // Phase 1G closeout ratchet (was 35/16/33/35 set at Phase 17F).
      // Coverage on this branch at close is statements 52.49%, branches
      // 45.09%, functions 27.84%, lines 52.26%; the floors sit ~3pp under
      // actuals so honest churn within Phase 3+ does not break CI.
      thresholds: {
        lines: 49,
        functions: 24,
        branches: 42,
        statements: 49,
      },
    },
  },
});
