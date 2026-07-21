import { describe, expect, it } from 'vitest';
import { redactConfigListOutput, redactConfigValue, redactUserinfo } from '../../src/Git/redact';

describe('redactUserinfo', () => {
  it('masks embedded credentials in a URL, keeping the host and path visible', () => {
    const expected = 'https://***@github.com/shellicar/claude-cli.git';
    const actual = redactUserinfo('https://x-access-token:ghp_abc123@github.com/shellicar/claude-cli.git');
    expect(actual).toBe(expected);
  });

  it('leaves a URL with no embedded credentials unchanged', () => {
    const expected = 'https://github.com/shellicar/claude-cli.git';
    const actual = redactUserinfo('https://github.com/shellicar/claude-cli.git');
    expect(actual).toBe(expected);
  });

  it('redacts every occurrence across multiple lines, e.g. git remote -v (fetch) and (push)', () => {
    const input = 'origin\thttps://token:secret@github.com/x/y.git (fetch)\norigin\thttps://token:secret@github.com/x/y.git (push)';
    const expected = 'origin\thttps://***@github.com/x/y.git (fetch)\norigin\thttps://***@github.com/x/y.git (push)';
    const actual = redactUserinfo(input);
    expect(actual).toBe(expected);
  });
});

describe('redactConfigValue', () => {
  it('redacts the whole value for a known credential-bearing key', () => {
    const expected = '***REDACTED***';
    const actual = redactConfigValue('http.https://github.com/.extraheader', 'AUTHORIZATION: basic abc123');
    expect(actual).toBe(expected);
  });

  it('redacts credential.* keys', () => {
    const expected = '***REDACTED***';
    const actual = redactConfigValue('credential.helper', 'store --file=/home/user/.git-credentials');
    expect(actual).toBe(expected);
  });

  it('only masks embedded userinfo for an ordinary key, leaving the rest visible', () => {
    const expected = 'https://***@github.com/x/y.git';
    const actual = redactConfigValue('remote.origin.url', 'https://token@github.com/x/y.git');
    expect(actual).toBe(expected);
  });

  it('leaves a non-credential value with nothing to redact untouched', () => {
    const expected = 'Stephen Hellicar';
    const actual = redactConfigValue('user.name', 'Stephen Hellicar');
    expect(actual).toBe(expected);
  });
});

describe('redactConfigListOutput', () => {
  it('redacts a credential-bearing line while leaving ordinary lines untouched', () => {
    const input = ['user.name=Stephen Hellicar', 'http.https://github.com/.extraheader=AUTHORIZATION: basic abc123', 'core.editor=vim'].join('\n');

    const expected = ['user.name=Stephen Hellicar', 'http.https://github.com/.extraheader=***REDACTED***', 'core.editor=vim'].join('\n');
    const actual = redactConfigListOutput(input);
    expect(actual).toBe(expected);
  });

  it('masks embedded userinfo in a remote.*.url line', () => {
    const input = 'remote.origin.url=https://token@github.com/x/y.git';
    const expected = 'remote.origin.url=https://***@github.com/x/y.git';
    const actual = redactConfigListOutput(input);
    expect(actual).toBe(expected);
  });
});
