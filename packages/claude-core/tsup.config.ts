import versionPlugin from '@shellicar/build-version/esbuild';
import { Strategies } from '@shellicar/build-version/types';
import { defineConfig, type Options } from 'tsup';

const esbuildPlugins = [versionPlugin({ strategies: [Strategies.git({ packageName: 'claude-core' }), Strategies.fallback('0.1.0')] })];

const commonOptions = (config: Options) =>
  ({
    bundle: true,
    clean: true,
    dts: true,
    entry: ['src/**/*.ts'],
    esbuildPlugins,
    esbuildOptions: (options) => {
      options.chunkNames = 'chunks/[name]-[hash]';
    },
    keepNames: true,
    minify: false,
    removeNodeProtocol: false,
    platform: 'node',
    sourcemap: true,
    splitting: true,
    target: 'node24',
    treeshake: false,
    watch: config.watch,
    tsconfig: 'tsconfig.json',
  }) satisfies Options;

export default defineConfig((config) => [
  {
    ...commonOptions(config),
    format: 'esm',
    outDir: 'dist/esm',
  },
  {
    ...commonOptions(config),
    format: 'cjs',
    outDir: 'dist/cjs',
  },
]);
