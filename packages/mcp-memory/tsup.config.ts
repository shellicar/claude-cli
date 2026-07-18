import versionPlugin from '@shellicar/build-version/esbuild';
import { defineConfig, type Options } from 'tsup';

const esbuildPlugins = [versionPlugin({ versionCalculator: 'gitversion' })];

const commonOptions = (config: Options) =>
  ({
    bundle: true,
    clean: true,
    dts: true,
    // Transitive runtime deps pulled in via @shellicar/claude-sdk-tools (a devDependency, so bundled) —
    // without this, esbuild has no signal to keep them external and inlines them wholesale.
    external: ['@anthropic-ai/sdk', '@js-joda/core', '@js-joda/locale_en', '@js-joda/timezone', '@shellicar/core-di-lite'],
    esbuildPlugins,
    esbuildOptions: (options) => {
      options.chunkNames = 'chunks/[name]-[hash]';
      options.entryNames = '[name]';
    },
    keepNames: true,
    minify: false,
    removeNodeProtocol: false,
    platform: 'node',
    sourcemap: true,
    splitting: true,
    target: 'node24',
    treeshake: true,
    watch: config.watch,
    tsconfig: 'tsconfig.json',
  }) satisfies Options;

export default defineConfig((config) => [
  {
    ...commonOptions(config),
    format: 'esm',
    outDir: 'dist/esm',
    entry: ['src/entry/*.ts'],
  },
  {
    ...commonOptions(config),
    format: 'cjs',
    outDir: 'dist/cjs',
    entry: ['src/entry/index.ts'],
  },
]);
