import { defineConfig } from 'vitest/config';

// Executor.spec.ts spawns a real process (via node:child_process) to prove the spawn
// wrapper itself — there is no fake for the thing under test. Run explicitly with
// `pnpm test:integration`, never picked up by a bare `vitest`/`pnpm test`.
export default defineConfig({
  test: {
    globals: true,
    include: ['test/Executor.spec.ts'],
  },
});
