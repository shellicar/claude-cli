import { defineConfig } from 'vitest/config';

// TsServerBridge specs spawn a real tsserver child process per test file. Under
// maxWorkers contention with the rest of the suite, the default 5s timeout flakes
// under load (a real timeout, not a broken test), so they get their own project:
// a longer timeout and fewer concurrent workers so the tsserver spawns don't starve
// each other. Every other spec keeps the tighter default in the "unit" project.
const TSSERVER_SPECS = ['test/Ts*.spec.ts'];

export default defineConfig({
  test: {
    testTimeout: 10_000,
    maxWorkers: '50%',
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['test/**/*.spec.ts'],
          exclude: TSSERVER_SPECS,
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'typescript',
          include: TSSERVER_SPECS,
          testTimeout: 30_000,
          maxWorkers: 2,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
