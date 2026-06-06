import semver from 'semver';

export type Decision = {
  channel: string;
  setLatest: boolean;
};

export const decide = (newVersion: string, currentLatest: string | null): Decision => {
  return { channel: '', setLatest: false };
};
