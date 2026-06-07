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
