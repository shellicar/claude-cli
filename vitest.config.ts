import { defineConfig } from 'vitest/config';

export default defineConfig({
  coverage: {
    provider: 'v8',
  },
  test: {
    projects: ['packages/*'],
  },
});
