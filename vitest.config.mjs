import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/test/**/*.test.mjs'],
    environment: 'node',
    testTimeout: 30_000,
    pool: 'forks',
  },
});
