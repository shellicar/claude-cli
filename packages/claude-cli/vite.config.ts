import { defineConfig } from 'vite-plus';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
    },
    include: ['test/**/*.spec.ts', 'src/**/*.test.ts'],
  },
});
