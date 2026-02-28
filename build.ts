import { writeFileSync } from 'node:fs';
import cleanPlugin from '@shellicar/build-clean/esbuild';
import versionPlugin from '@shellicar/build-version/esbuild';
import * as esbuild from 'esbuild';
import { glob } from 'glob';
import { generateJsonSchema } from './src/cli-config.js';

const watch = process.argv.some((x) => x === '--watch');
const minify = !watch;

const plugins = [cleanPlugin({ destructive: true }), versionPlugin({ versionCalculator: 'git' })];

const inject = await glob('./inject/*.ts');

const ctx = await esbuild.context({
  banner: { js: '#!/usr/bin/env node' },
  bundle: true,
  entryPoints: ['src/main.ts'],
  inject,
  entryNames: '[name]',
  keepNames: true,
  format: 'esm',
  minify,
  outdir: 'dist',
  platform: 'node',
  plugins,
  sourcemap: true,
  target: 'node22',
  treeShaking: true,
  dropLabels: ['DEBUG'],
  tsconfig: 'tsconfig.json',
  external: ['@anthropic-ai/claude-agent-sdk'],
});

if (watch) {
  await ctx.watch();
  console.log('watching...');
} else {
  await ctx.rebuild();
  ctx.dispose();

  const schema = generateJsonSchema();
  writeFileSync('schema/cli-config.schema.json', `${JSON.stringify(schema, null, 2)}\n`);
}
