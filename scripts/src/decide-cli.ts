import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { decide } from './decide-dist-tags.js';

// scripts/src -> scripts -> repo root
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const args = process.argv.slice(2);
const packageDirIdx = args.indexOf('--package-dir');
const currentLatestIdx = args.indexOf('--current-latest');

const packageDir = packageDirIdx >= 0 ? args[packageDirIdx + 1] : undefined;
const currentLatestArg = currentLatestIdx >= 0 ? args[currentLatestIdx + 1] : undefined;

if (!packageDir) {
  process.stderr.write('--package-dir is required\n');
  process.exit(1);
}

const packageJson = JSON.parse(readFileSync(resolve(repoRoot, packageDir, 'package.json'), 'utf8')) as {
  version: string;
};
const version = packageJson.version;
const currentLatest = currentLatestArg || null;

try {
  const result = decide(version, currentLatest);
  process.stdout.write(`version=${version}\nchannel=${result.channel}\nsetLatest=${result.setLatest}\n`);
} catch (err) {
  process.stderr.write((err instanceof Error ? err.message : String(err)) + '\n');
  process.exit(1);
}
