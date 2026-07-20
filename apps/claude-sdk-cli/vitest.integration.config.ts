import { defineConfig } from 'vitest/config';

// DatabaseFactory.spec.ts opens a second real DatabaseSync connection on the same file to
// prove WAL/busy_timeout contention handling — an in-memory db can't be shared across
// connections, so this is the only way to test it. Run explicitly with
// `pnpm test:integration`, never picked up by a bare `vitest`/`pnpm test`.
export default defineConfig({
  test: {
    include: ['test/DatabaseFactory.spec.ts'],
  },
});
