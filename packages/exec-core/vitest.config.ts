import { defineConfig } from 'vitest/config';

// test/integration/ spawns a real process (see vitest.integration.config.ts) — kept out of the
// default run, physically and logically, so `vitest`/`pnpm test` never touches a real OS process.
export default defineConfig({
  test: {
    globals: true,
    exclude: ['test/integration/**', '**/node_modules/**'],
    // test/integration/ is this package's only spec directory right now, and it's excluded —
    // zero matched tests here is expected, not a failure.
    passWithNoTests: true,
  },
});
