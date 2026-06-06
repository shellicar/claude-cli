import { fileURLToPath } from 'url';
import semver from 'semver';

export type Decision = {
  channel: string;
  setLatest: boolean;
};

export const decide = (newVersion: string, currentLatest: string | null): Decision => {
  const parsed = semver.parse(newVersion);
  if (!parsed) {
    throw new Error(`Invalid semver: ${newVersion}`);
  }

  const { prerelease } = parsed;

  let channel: string;

  if (prerelease.length === 0) {
    channel = 'latest';
  } else {
    if (prerelease.length !== 2) {
      throw new Error(`Pre-release must have exactly two identifiers (<name>.<number>): ${newVersion}`);
    }
    const [name, num] = prerelease;
    if (typeof name !== 'string') {
      throw new Error(`Pre-release first identifier must be a string: ${newVersion}`);
    }
    if (typeof num !== 'number') {
      throw new Error(`Pre-release second identifier must be a number: ${newVersion}`);
    }
    if (name === 'latest') {
      throw new Error(`"latest" is a reserved channel name: ${newVersion}`);
    }
    channel = name;
  }

  const setLatest = currentLatest === null || semver.gt(newVersion, currentLatest) === true;

  return { channel, setLatest };
};

// CLI entry point — runs when executed directly via tsx
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const versionIdx = args.indexOf('--version');
  const currentLatestIdx = args.indexOf('--current-latest');

  const version = versionIdx >= 0 ? args[versionIdx + 1] : undefined;
  const currentLatestArg = currentLatestIdx >= 0 ? args[currentLatestIdx + 1] : undefined;

  if (!version) {
    process.stderr.write('--version is required\n');
    process.exit(1);
  }

  const currentLatest = currentLatestArg || null;

  try {
    const result = decide(version, currentLatest);
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (err) {
    process.stderr.write((err instanceof Error ? err.message : String(err)) + '\n');
    process.exit(1);
  }
}
