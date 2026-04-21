import { beforeEach, describe, expect, it } from 'vitest';
import { expandPath } from '../src/fs/expandPath';
import { MemoryFileSystem } from './MemoryFileSystem';

describe('expandPath', () => {
  let fs: MemoryFileSystem;
  beforeEach(() => {
    fs = new MemoryFileSystem('/home/test');
  });

  describe('tilde expansion', () => {
    it('expands ~ to home directory', () => {
      const expected = '/home/test';
      const actual = expandPath('~', fs);
      expect(actual).toBe(expected);
    });

    it('expands ~/path', () => {
      const expected = '/home/test/projects';
      const actual = expandPath('~/projects', fs);
      expect(actual).toBe(expected);
    });

    it('does not expand ~ in the middle of a string', () => {
      const expected = '/foo/~/bar';
      const actual = expandPath('/foo/~/bar', fs);
      expect(actual).toBe(expected);
    });

    it('does not expand ~username', () => {
      const expected = '~root/bin';
      const actual = expandPath('~root/bin', fs);
      expect(actual).toBe(expected);
    });

    it('uses fs.homedir() for ~ expansion', () => {
      const customFs = new MemoryFileSystem('/custom/home');
      const expected = '/custom/home/projects';
      const actual = expandPath('~/projects', customFs);
      expect(actual).toBe(expected);
    });

    it('expands bare ~ using fs.homedir()', () => {
      const overrideFs = new MemoryFileSystem('/override');
      const expected = '/override';
      const actual = expandPath('~', overrideFs);
      expect(actual).toBe(expected);
    });
  });

  describe('env var expansion', () => {
    it('expands $VAR using the injectable getEnvVar', () => {
      fs.setEnvVar('TEST_EXPAND_VAR', '/test/value');
      const expected = '/test/value';
      const actual = expandPath('$TEST_EXPAND_VAR', fs);
      expect(actual).toBe(expected);
    });

    it('expands ${VAR} using the injectable getEnvVar', () => {
      fs.setEnvVar('TEST_EXPAND_VAR', '/test/value');
      const expected = '/test/value/sub';
      const actual = expandPath('${TEST_EXPAND_VAR}/sub', fs);
      expect(actual).toBe(expected);
    });

    it('expands $HOME', () => {
      const expected = '/home/hello';
      fs.setEnvVar('HOME', expected);
      const actual = expandPath('$HOME', fs);
      expect(actual).toBe(expected);
    });

    it('expands ${HOME}/path', () => {
      const expected = '/home/hello/foo';
      fs.setEnvVar('HOME', '/home/hello');
      const actual = expandPath('${HOME}/foo', fs);
      expect(actual).toBe(expected);
    });

    it('expands multiple vars in one string', () => {
      fs.setEnvVar('TEST_A', 'foo');
      fs.setEnvVar('TEST_B', 'bar');
      const expected = 'foo/bar';
      const actual = expandPath('$TEST_A/$TEST_B', fs);
      expect(actual).toBe(expected);
    });

    it('returns empty string for undefined env var', () => {
      const expected = '';
      const actual = expandPath('$THIS_VAR_DOES_NOT_EXIST_XYZ', fs);
      expect(actual).toBe(expected);
    });
  });

  describe('plain paths', () => {
    it('returns absolute paths unchanged', () => {
      const expected = '/usr/local/bin';
      const actual = expandPath('/usr/local/bin', fs);
      expect(actual).toBe(expected);
    });

    it('returns plain program names unchanged', () => {
      const expected = 'git';
      const actual = expandPath('git', fs);
      expect(actual).toBe(expected);
    });
  });

  describe('undefined handling', () => {
    it('returns undefined for undefined input', () => {
      const actual = expandPath(undefined, fs);
      expect(actual).toBeUndefined();
    });
  });
});
