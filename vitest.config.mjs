import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/test/**/*.test.mjs'],
    environment: 'node',
    testTimeout: 300_000,
    hookTimeout: 300_000,
    pool: 'forks',
  },
});
