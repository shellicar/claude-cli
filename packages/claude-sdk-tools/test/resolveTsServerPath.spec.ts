import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveTsServerPath, TSSERVER_PATH_ENV } from '../src/typescript/TsServerService';

describe('resolveTsServerPath', () => {
  afterEach(() => {
    delete process.env[TSSERVER_PATH_ENV];
  });

  it('returns the env-var path when it points at an existing file', () => {
    const expected = __filename;
    process.env[TSSERVER_PATH_ENV] = __filename;

    const actual = resolveTsServerPath();

    expect(actual).toBe(expected);
  });

  it('returns null when the env-var path does not exist', () => {
    process.env[TSSERVER_PATH_ENV] = path.join(__dirname, 'no-such-tsserver.js');

    const actual = resolveTsServerPath();

    expect(actual).toBeNull();
  });
});
