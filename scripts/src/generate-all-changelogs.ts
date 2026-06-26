import { execFileSync } from 'node:child_process';
import { glob } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Regenerate every package's CHANGELOG.md from its changes.jsonl.
//
// Discovers packages the same way validate-changes.ts does (every changes.jsonl
// in the workspace), then runs the single-package generator on each. The
// generator (generate-changelog.ts) is run unchanged as a subprocess, so this
// stays a thin "run it on all" wrapper with no duplicated rendering logic.

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..', '..');
const generator = resolve(scriptDir, 'generate-changelog.ts');

async function main() {
  const packageDirs: string[] = [];
  for await (const entry of glob('**/changes.jsonl', {
    cwd: repoRoot,
    exclude: (p) => p.includes('node_modules') || p.includes('.git') || p.includes('dist'),
  })) {
    packageDirs.push(dirname(resolve(repoRoot, entry)));
  }

  if (packageDirs.length === 0) {
    console.error('no changes.jsonl files found');
    process.exit(2);
  }

  packageDirs.sort();

  for (const packageDir of packageDirs) {
    execFileSync('tsx', [generator, packageDir], { cwd: scriptDir, stdio: 'inherit' });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
