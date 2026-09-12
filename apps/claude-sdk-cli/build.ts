import { writeFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import versionPlugin from '@shellicar/build-version/esbuild';
import { Strategies } from '@shellicar/build-version/types';
import * as esbuild from 'esbuild';
import { generateJsonSchema } from './src/cli-config/generateJsonSchema.js';
// biome-ignore lint/correctness/noUnusedImports: kept for when validate() below is re-enabled
import { sdkConfigSchema } from './src/cli-config/schema.js';
// biome-ignore lint/correctness/noUnusedImports: kept for when validate() below is re-enabled
import { buildContainer } from './src/setup/container.js';

const watch = process.argv.some((x) => x === '--watch');
const minify = !watch;

// Reads the static @dependsOn graph and reports wiring problems (an unregistered token, a missing
// face) without constructing anything — no options value below is ever read. Catches a registration
// mistake (see CLAUDE.md/memory: a class un-selfed to only .as(IFoo) while something still resolves
// the concrete) at build time instead of at first runtime resolve.
//
// Temporarily disabled: validate() reports IServiceProvider as MISSING_TARGET even though it needs
// no registration (confirmed working at runtime as of core-di@5.0.0-alpha.5 — see
// /tmp/core-di-repro/repro-validate.spec.ts). Re-enable once that's fixed upstream.
// const report = buildContainer({
//   configOptions: { schema: sdkConfigSchema, paths: [] },
//   runtimeOptions: { modelOverride: null, systemFlagText: null, claudeMdFlagText: null, tsAvailable: false },
//   tsServerOptions: { tsserverPath: null, timeoutMs: 0 },
//   databaseOptions: { inMemory: true },
// }).validate();
// if (!report.valid) {
//   console.error('claude-sdk-cli: DI graph validation failed');
//   for (const problem of report.problems) {
//     console.error(`  [${problem.kind}] ${problem.message}`);
//   }
//   process.exit(1);
// }

const plugins = [versionPlugin({ strategies: [Strategies.git({ packageName: 'claude-sdk-cli' }), Strategies.fallback('0.1.0')] })];
const inject = await Array.fromAsync(glob('./inject/*.ts'));

const ctx = await esbuild.context({
  dropLabels: watch ? [] : ['DEBUG'],
  banner: { js: '#!/usr/bin/env node' },
  bundle: true,
  chunkNames: 'chunks/[name]-[hash]',
  entryNames: '[name]',
  entryPoints: ['src/entry/*.ts'],
  // packages: 'external',
  // Native addon: esbuild has no loader for .node files, and the compiled binary must stay a
  // filesystem-relative require, not get inlined. Kept external; the platform package convention
  // (see platforms/claude-sdk-cli-darwin-arm64) is how this ships alongside the SEA binary.
  external: ['@shellicar/keychain-native'],
  format: 'esm',
  inject,
  keepNames: true,
  minify,
  outdir: 'dist',
  platform: 'node',
  plugins,
  sourcemap: true,
  splitting: false,
  target: 'node26',
  treeShaking: true,
  tsconfig: 'tsconfig.json',
});

if (watch) {
  await ctx.watch();
  console.log('watching...');
} else {
  await ctx.rebuild();
  ctx.dispose();

  const schema = generateJsonSchema();
  writeFileSync('../../schema/sdk-config.schema.json', `${JSON.stringify(schema, null, 2)}\n`);
}
