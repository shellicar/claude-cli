import { defineConfig } from 'vitest/config';

// test/integration/ holds specs that spawn a real tsserver process or real pipe/SIGPIPE
// behaviour no fake can produce — real OS resources with no substitute for the thing under
// test. Kept out of the default run entirely, physically and logically (see
// vitest.integration.config.ts), so `vitest`/`pnpm test` never touches them.
export default defineConfig({
  test: {
    testTimeout: 10_000,
    maxWorkers: '50%',
    include: ['test/**/*.spec.ts'],
    exclude: ['test/integration/**'],
  },
});
