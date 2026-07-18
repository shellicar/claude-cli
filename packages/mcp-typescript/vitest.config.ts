import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    maxWorkers: 1,
    // vitest's own 5000ms default is shorter than a cold tsserver spawn can
    // take on a loaded CI runner (this job builds 14 packages before tests
    // even start); this is the ceiling actually killing the test, separate
    // from TSSERVER_TIMEOUT_MS in src/entry/index.ts, which only bounds a
    // single request to an already-running tsserver.
    testTimeout: 20_000,
  },
});
