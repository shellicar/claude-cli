import { defineConfig } from 'vitest/config';

// TsServerBridge specs spawn a real tsserver child process per test file; under maxWorkers
// contention the default 5s timeout flakes under load (a real timeout, not a broken test),
// so this project gets a longer timeout and fewer concurrent workers.
// ExecV3/pipeline-teardown.spec.ts spawns real pipes/SIGPIPE behaviour no fake can produce.
// Run explicitly with `pnpm test:integration`, never picked up by a bare `vitest`/`pnpm test`.
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'typescript',
          include: ['test/integration/Ts*.spec.ts'],
          testTimeout: 30_000,
          maxWorkers: 2,
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'pipeline-teardown',
          include: ['test/integration/pipeline-teardown.spec.ts'],
          testTimeout: 10_000,
          sequence: { groupOrder: 1 },
        },
      },
      {
        extends: true,
        test: {
          name: 'general',
          include: ['test/integration/**/*.spec.ts'],
          exclude: ['test/integration/Ts*.spec.ts', 'test/integration/pipeline-teardown.spec.ts'],
          testTimeout: 10_000,
          sequence: { groupOrder: 2 },
        },
      },
    ],
  },
});
