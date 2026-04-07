import { writeFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import cleanPlugin from '@shellicar/build-clean/esbuild';
import versionPlugin from '@shellicar/build-version/esbuild';
import * as esbuild from 'esbuild';
import { generateJsonSchema } from './src/cli-config/generateJsonSchema.js';

const watch = process.argv.some((x) => x === '--watch');
const minify = !watch;

const plugins = [cleanPlugin({ destructive: true }), versionPlugin({ versionCalculator: 'gitversion' })];
const inject = await Array.fromAsync(glob('./inject/*.ts'));

const ctx = await esbuild.context({
  dropLabels: watch ? [] : ['DEBUG'],
  banner: { js: '#!/usr/bin/env node' },
  bundle: true,
  chunkNames: 'chunks/[name]-[hash]',
  entryNames: 'entry/[name]',
  entryPoints: ['src/entry/*.ts'],
  external: ['@anthropic-ai/sdk'],
  format: 'esm',
  inject,
  keepNames: true,
  minify,
  outdir: 'dist',
  platform: 'node',
  plugins,
  sourcemap: true,
  splitting: true,
  target: 'node24',
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
