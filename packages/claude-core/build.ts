import { glob } from 'node:fs/promises';
import cleanPlugin from '@shellicar/build-clean/esbuild';
import versionPlugin from '@shellicar/build-version/esbuild';
import * as esbuild from 'esbuild';

const watch = process.argv.some((x) => x === '--watch');

const plugins = [cleanPlugin({ destructive: true }), versionPlugin({ versionCalculator: 'gitversion' })];

const inject = await Array.fromAsync(glob('./inject/*.ts'));

const ctx = await esbuild.context({
  bundle: true,
  entryPoints: ['src/*.ts'],
  inject,
  entryNames: '[name]',
  chunkNames: 'chunks/[name]-[hash]',
  keepNames: true,
  format: 'esm',
  minify: false,
  splitting: true,
  outdir: 'dist',
  platform: 'node',
  plugins,
  sourcemap: true,
  target: 'node22',
  treeShaking: false,
  tsconfig: 'tsconfig.json',
});

if (watch) {
  await ctx.watch();
  console.log('watching...');
} else {
  await ctx.rebuild();
  ctx.dispose();
}
