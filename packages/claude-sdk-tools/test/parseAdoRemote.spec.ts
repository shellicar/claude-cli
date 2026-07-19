import { describe, expect, it } from 'vitest';
import { parseAdoRemote } from '../src/AzureDevOps/parseAdoRemote';

describe('parseAdoRemote', () => {
  describe('https remotes', () => {
    it('parses org, project, and repository from a plain https remote', () => {
      const expected = { orgUrl: 'https://dev.azure.com/shellicar/', project: 'shellicar', repository: 'shellicar' };
      const actual = parseAdoRemote('https://dev.azure.com/shellicar/shellicar/_git/shellicar');
      expect(actual).toEqual(expected);
    });

    it('parses a remote carrying a username before the host', () => {
      const expected = { orgUrl: 'https://dev.azure.com/shellicar/', project: 'shellicar', repository: 'shellicar' };
      const actual = parseAdoRemote('https://shellicar@dev.azure.com/shellicar/shellicar/_git/shellicar');
      expect(actual).toEqual(expected);
    });

    it('parses distinct org, project, and repository values', () => {
      const expected = { orgUrl: 'https://dev.azure.com/myorg/', project: 'core-foundation', repository: 'api' };
      const actual = parseAdoRemote('https://dev.azure.com/myorg/core-foundation/_git/api');
      expect(actual).toEqual(expected);
    });

    it('strips a trailing .git suffix', () => {
      const expected = { orgUrl: 'https://dev.azure.com/shellicar/', project: 'shellicar', repository: 'shellicar' };
      const actual = parseAdoRemote('https://dev.azure.com/shellicar/shellicar/_git/shellicar.git');
      expect(actual).toEqual(expected);
    });

    it('decodes percent-encoded project and repository names', () => {
      const expected = { orgUrl: 'https://dev.azure.com/shellicar/', project: 'my project', repository: 'my repo' };
      const actual = parseAdoRemote('https://dev.azure.com/shellicar/my%20project/_git/my%20repo');
      expect(actual).toEqual(expected);
    });
  });

  describe('ssh remotes', () => {
    it('parses org, project, and repository from an ssh v3 remote', () => {
      const expected = { orgUrl: 'https://dev.azure.com/shellicar/', project: 'shellicar', repository: 'shellicar' };
      const actual = parseAdoRemote('git@ssh.dev.azure.com:v3/shellicar/shellicar/shellicar');
      expect(actual).toEqual(expected);
    });
  });

  describe('legacy visualstudio.com remotes', () => {
    it('parses org, project, and repository, rewriting the org URL to dev.azure.com', () => {
      const expected = { orgUrl: 'https://dev.azure.com/shellicar/', project: 'shellicar', repository: 'shellicar' };
      const actual = parseAdoRemote('https://shellicar.visualstudio.com/shellicar/_git/shellicar');
      expect(actual).toEqual(expected);
    });
  });

  describe('non-ADO remotes', () => {
    it('returns null for a GitHub remote', () => {
      const expected = null;
      const actual = parseAdoRemote('https://github.com/shellicar/claude-cli.git');
      expect(actual).toBe(expected);
    });

    it('returns null for an unrelated string', () => {
      const expected = null;
      const actual = parseAdoRemote('not a url at all');
      expect(actual).toBe(expected);
    });
  });
});
