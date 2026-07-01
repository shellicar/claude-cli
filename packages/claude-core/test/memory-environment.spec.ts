import { describe, expect, it } from 'vitest';
import { parseGitRemote } from '../src/memory/environment';

describe('parseGitRemote', () => {
  it('parses a GitHub HTTPS remote', () => {
    const expected = { host: 'github', org: 'shellicar', repo: 'claude-cli' };

    const actual = parseGitRemote('https://github.com/shellicar/claude-cli.git');

    expect(actual).toEqual(expected);
  });

  it('parses a GitHub SSH remote', () => {
    const expected = { host: 'github', org: 'shellicar', repo: 'claude-cli' };

    const actual = parseGitRemote('git@github.com:shellicar/claude-cli.git');

    expect(actual).toEqual(expected);
  });

  it('parses an Azure HTTPS remote', () => {
    const expected = { host: 'azure', org: 'org', project: 'project', repo: 'repo' };

    const actual = parseGitRemote('https://org@dev.azure.com/org/project/_git/repo');

    expect(actual).toEqual(expected);
  });

  it('parses an Azure SSH remote', () => {
    const expected = { host: 'azure', org: 'org', project: 'project', repo: 'repo' };

    const actual = parseGitRemote('git@ssh.dev.azure.com:v3/org/project/repo');

    expect(actual).toEqual(expected);
  });

  it('yields nothing for an unrecognised remote', () => {
    const expected = {};

    const actual = parseGitRemote('https://example.com/x/y');

    expect(actual).toEqual(expected);
  });
});
