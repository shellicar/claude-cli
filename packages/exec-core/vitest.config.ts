import { defineConfig } from 'vitest/config';

// Executor.spec.ts spawns a real process (see vitest.integration.config.ts) — kept out of the
// default run so `vitest`/`pnpm test` never touches a real OS process.
export default defineConfig({
  test: {
    globals: true,
    exclude: ['test/Executor.spec.ts', '**/node_modules/**'],
    // Executor.spec.ts is this package's only spec, and it's the excluded integration one —
    // zero matched tests here is expected, not a failure.
    passWithNoTests: true,
  },
});
