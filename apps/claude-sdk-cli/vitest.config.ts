import { defineConfig } from 'vitest/config';

// test/integration/ opens a second real DatabaseSync connection on the same file to prove
// WAL/busy_timeout contention handling — an in-memory db can't be shared across connections,
// so this is the only way to test it. Kept out of the default run entirely, physically and
// logically (see vitest.integration.config.ts), so `vitest`/`pnpm test` never touches it.
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    exclude: ['test/integration/**', '**/node_modules/**'],
  },
});
