import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: ['src/**/*.ts'],
    platform: 'node',
    target: 'node22',
    tsconfig: 'tsconfig.json',
    format: ['esm', 'cjs'],
    outDir: 'dist',
    sourcemap: true,
    minify: true,
    clean: true,
    dts: {
      tsgo: true,
    },
    exports: true,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ignorePatterns: ['dist/**'],
  },
});
