import { defineConfig } from 'vitest/config';

// The default tier: specs directly under test/, which touch no real process or disk. The ones
// under test/integration/ spawn for real and are excluded here, run only by `pnpm test:integration`.
export default defineConfig({
  test: {
    include: ['test/*.spec.ts'],
  },
});
