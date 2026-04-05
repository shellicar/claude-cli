import { glob } from 'node:fs/promises';
import cleanPlugin from '@shellicar/build-clean/esbuild';
import versionPlugin from '@shellicar/build-version/esbuild';
import * as esbuild from 'esbuild';

const watch = process.argv.some((x) => x === '--watch');
const _minify = !watch;

const plugins = [cleanPlugin({ destructive: true }), versionPlugin({ versionCalculator: 'gitversion' })];

const inject = await Array.fromAsync(glob('./inject/*.ts'));

const ctx = await esbuild.context({
  bundle: true,
  entryPoints: ['src/index.ts'],
  inject,
  entryNames: '[name]',
  keepNames: true,
  format: 'esm',
  minify: false,
  outdir: 'dist',
  platform: 'node',
  plugins,
  sourcemap: true,
  external: ['@anthropic-ai/sdk'],
  target: 'node24',
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
