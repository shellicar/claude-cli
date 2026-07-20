import { defineConfig } from 'vitest/config';

// TsServerBridge specs spawn a real tsserver child process; ExecV3/pipeline-teardown.spec.ts
// spawns real pipe/SIGPIPE behaviour no fake can produce. Both are real OS resources with no
// substitute for the thing under test, kept out of the default run entirely (see
// vitest.integration.config.ts) so `vitest`/`pnpm test` never touches them.
const INTEGRATION_SPECS = ['test/Ts*.spec.ts', 'test/ExecV3/pipeline-teardown.spec.ts'];

export default defineConfig({
  test: {
    testTimeout: 10_000,
    maxWorkers: '50%',
    include: ['test/**/*.spec.ts'],
    exclude: INTEGRATION_SPECS,
  },
});
