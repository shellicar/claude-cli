import { describe, expect, it } from 'vitest';
import { orgArgs } from '../../src/AzureDevOps/tools';

describe('orgArgs', () => {
  it('uses the explicit org over a parsed remote', () => {
    const expected = ['--org', 'https://dev.azure.com/explicit/'];
    const actual = orgArgs('https://dev.azure.com/explicit/', { orgUrl: 'https://dev.azure.com/remote/', project: 'p', repository: 'r' });
    expect(actual).toEqual(expected);
  });

  it('falls back to the org parsed from the remote when none is given explicitly', () => {
    const expected = ['--org', 'https://dev.azure.com/remote/'];
    const actual = orgArgs(undefined, { orgUrl: 'https://dev.azure.com/remote/', project: 'p', repository: 'r' });
    expect(actual).toEqual(expected);
  });

  it('omits --org entirely when neither an explicit org nor a remote is available', () => {
    const expected: string[] = [];
    const actual = orgArgs(undefined, null);
    expect(actual).toEqual(expected);
  });
});
