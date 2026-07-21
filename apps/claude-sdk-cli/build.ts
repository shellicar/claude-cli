import { writeFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import versionPlugin from '@shellicar/build-version/esbuild';
import { Strategies } from '@shellicar/build-version/types';
import * as esbuild from 'esbuild';
import { generateJsonSchema } from './src/cli-config/generateJsonSchema.js';

const watch = process.argv.some((x) => x === '--watch');
const minify = !watch;

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
